import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:crypto/crypto.dart';
import '../config_store.dart';
import '../widgets/splash_view.dart';

/// PIN mode operator (masuk ke menu operator). Bisa diganti saat build:
/// `flutter build apk --release --dart-define=OPERATOR_PIN=pinbaru`.
/// Default ini hanya gerbang UI — APK di-distribusikan lewat sideload sekolah.
const String kOperatorPin = String.fromEnvironment('OPERATOR_PIN', defaultValue: 'sman1gorontalo2026');

/// QA internal: aktifkan dengan --dart-define=QA_WEBVIEW_DEBUG=true saat build
/// debug untuk keperluan pengujian (CDP). Release distribusi = false.
const bool kQaWebViewDebug = bool.fromEnvironment('QA_WEBVIEW_DEBUG', defaultValue: false);

/// MethodChannel kiosk: screen pinning + alarm pelanggaran + getar.
/// Terdaftar di MainActivity.kt.
const MethodChannel _kioskChannel = MethodChannel('id.sch.sman1gorontalo.seb/kiosk');

/// Listener lifecycle andal dari native (onPause/onResume selalu terpanggil,
/// sedangkan Flutter WidgetsBindingObserver bisa melewatkan transisi amat cepat).
const MethodChannel _lifecycleChannel = MethodChannel('id.sch.sman1gorontalo.seb/lifecycle');

/// Bersihkan sesi web CBT (paksa login ulang). Tidak menyentuh konfigurasi
/// operator (Base URL / Browser Exam Key / preferensi kunci layar).
const String kForcedReloginJs = r'''
try { localStorage.removeItem('cbt_token'); } catch (e) {}
try { localStorage.removeItem('cbt_refresh'); } catch (e) {}
try { sessionStorage.clear(); } catch (e) {}
if (location.pathname !== '/') { location.replace('/'); }
''';

/// Polyfill bridge SEB yang diinjeksikan setelah halaman selesai dimuat.
/// Webapp memanggil `window.SebBridge.requestHash(url)`; polyfill meneruskan
/// ke native lewat channel `SebBridgeNative` (fire-and-forget) lalu native
/// memanggil `window.__sebBridgeDone(id, hash)` untuk menyelesaikan Promise.
const String kBridgePolyfill = r'''
(function () {
  if (window.SebBridge) return;
  var pending = {};
  var counter = 0;
  window.__sebBridgeDone = function (id, hash) {
    var cb = pending[id];
    delete pending[id];
    if (cb) cb(hash || null);
  };
  window.SebBridge = {
    requestHash: function (url) {
      return new Promise(function (resolve) {
        counter += 1;
        var id = 'req_' + counter;
        pending[id] = resolve;
        try {
          SebBridgeNative.postMessage(JSON.stringify({ id: id, url: String(url) }));
        } catch (e) {
          delete pending[id];
          resolve(null);
        }
      });
    },
    alarm: function (reason) {
      try {
        SebBridgeNative.postMessage(JSON.stringify({ type: 'alarm', reason: String(reason || 'violation') }));
      } catch (e) {
        /* bukan di APK — abaikan */
      }
    },
    maximizeVolume: function () {
      try {
        SebBridgeNative.postMessage(JSON.stringify({ type: 'maximizeVolume' }));
      } catch (e) {
        /* bukan di APK — abaikan */
      }
    }
  };
})();
''';

class KioskScreen extends StatefulWidget {
  const KioskScreen({super.key, required this.config, required this.onConfigChanged});

  final SebConfig config;
  final VoidCallback onConfigChanged;

  @override
  State<KioskScreen> createState() => _KioskScreenState();
}

class _KioskScreenState extends State<KioskScreen> with WidgetsBindingObserver {
  final ConfigStore _store = ConfigStore();
  late final WebViewController _controller;
  int _progress = 0;
  bool _fatal = false;
  String? _fatalDesc;
  int _cornerTaps = 0;
  DateTime? _lastCornerTap;
  bool _leftApp = false;
  bool _coldStart = true;
  bool _lockTaskEnabled = true;
  DateTime? _suppressBackgroundUntil;
  bool _webReady = false;

  /// Splash minimal tampil — beri waktu cukup bagi pengguna menikmati
  /// layar merek; berlaku saat cold start (reload manual tetap responsif).
  bool _minSplashElapsed = false;

  /// Keluar disengaja (operator/admin menutup aplikasi) — jangan bunyikan
  /// alarm atau catat pelanggaran palsu pada jeda "sementara".
  bool _exitInProgress = false;

  late final String _base = widget.config.baseUrl!;
  late final Uri _origin = ConfigStore.originOf(_base);

  bool _sameOrigin(Uri? u) =>
      u != null && u.scheme == _origin.scheme && u.host == _origin.host && u.port == _origin.port;

  bool _isSameOriginString(String url) {
    try {
      return _sameOrigin(Uri.parse(url));
    } on FormatException {
      return false;
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _lifecycleChannel.setMethodCallHandler(_onNativeLifecycle);
    _controller = _buildController();
    if (kQaWebViewDebug) {
      AndroidWebViewController.enableDebugging(true);
    }
    unawaited(_applyAndroidWebSettings());
    unawaited(_syncLockTask());
    Future<void>.delayed(const Duration(milliseconds: 2100), () {
      if (mounted) setState(() => _minSplashElapsed = true);
    });
  }

  @override
  void dispose() {
    _lifecycleChannel.setMethodCallHandler(null);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Handler lifecycle native — dipercaya lebih andal daripada Flutter observer
  /// untuk transisi Home→angkat cepat. `_leftApp` menjaga idempotensi.
  Future<void> _onNativeLifecycle(MethodCall call) async {
    if (_exitInProgress) return;
    if (call.method == 'paused') {
      if (_leftApp || _backgroundSuppressed()) return;
      _leftApp = true;
      unawaited(_onLeaveApp());
    } else if (call.method == 'resumed') {
      if (_leftApp) {
        _leftApp = false;
        unawaited(_forceRelogin());
        unawaited(_syncLockTask());
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_exitInProgress) return;
    // Fallback Flutter — handler native (_onNativeLifecycle) yang utama.
    // (Android mengirim `hidden` lalu `paused` — cukup sekali per backgrounding.)
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      if (_leftApp || _backgroundSuppressed()) return;
      _leftApp = true;
      unawaited(_onLeaveApp());
    } else if (state == AppLifecycleState.resumed) {
      if (_leftApp) {
        _leftApp = false;
        unawaited(_forceRelogin());
        unawaited(_syncLockTask());
      }
    }
  }

  /// Dialog konfirmasi pin layar Android (startLockTask) dapat memicu transisi
  /// lifecycle sesaat — jangan anggap itu "keluar aplikasi".
  bool _backgroundSuppressed() {
    final until = _suppressBackgroundUntil;
    return until != null && DateTime.now().isBefore(until);
  }

  Future<void> _onLeaveApp() async {
    if (_exitInProgress) return;
    try {
      await _kioskChannel.invokeMethod('playAlarm');
    } catch (_) {
      // Perangkat tanpa alarm — pelanggaran tetap dicatat lewat JS.
    }
    await _fireAppHidden();
  }

  /// Paksa login ulang: hapus token sesi web + kembali ke halaman utama (login).
  /// Dipanggil saat aplikasi dibuka kembali setelah ditinggalkan, dan sekali
  /// saat cold start (aplikasi di-swipe/dibunuh lalu dibuka lagi).
  /// Preferensi non-auth (tema, pemilih sekolah) sengaja tidak dihapus.
  Future<void> _forceRelogin() async {
    try {
      await _controller.runJavaScript(kForcedReloginJs);
    } catch (_) {
      // WebView belum/ tidak bisa dievaluasi — diabaikan.
    }
  }

  /// Screen pinning BYOD: panggil native startLockTask/stopLockTask sesuai
  /// preferensi operator (default: aktif).
  Future<void> _syncLockTask() async {
    final enabled = await _store.lockTask();
    if (!mounted) return;
    setState(() => _lockTaskEnabled = enabled);
    try {
      if (enabled) {
        final until = DateTime.now().add(const Duration(seconds: 3)).millisecondsSinceEpoch;
        _suppressBackgroundUntil = DateTime.now().add(const Duration(seconds: 3));
        unawaited(_kioskChannel.invokeMethod('suppressAlarm', {'until': until}));
        await _kioskChannel.invokeMethod('startLockTask');
      } else {
        await _kioskChannel.invokeMethod('stopLockTask');
      }
    } catch (_) {
      // OS menolak pinning — aplikasi tetap immersive fullscreen.
    }
  }

  Future<void> _fireAppHidden() async {
    try {
      await _controller.runJavaScript(
        "document.dispatchEvent(new Event('cbt:apphidden'));",
      );
    } catch (_) {
      // WebView sedang tidak bisa dievaluasi — diabaikan.
    }
  }

  Future<void> _reload() async {
    setState(() {
      _fatal = false;
      _fatalDesc = null;
      _progress = 0;
      _webReady = false;
    });
    await _controller.reload();
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message), behavior: SnackBarBehavior.floating));
  }

  Future<void> _refreshPage() async {
    _toast('Memuat ulang…');
    setState(() => _webReady = false);
    await _controller.reload();
  }

  /// Minta server memverifikasi key yang tersimpan di perangkat ini.
  /// Murni HTTP native (tidak lewat WebView) sehingga bisa dipakai operator
  /// SEBELUM siswa login — hasilnya: key cocok / tidak cocok / server belum siap.
  Future<void> _runSelfTest() async {
    final key = await _store.examKey();
    if (!mounted) return;
    if (key == null || key.isEmpty) {
      await _infoDialog('Uji key ke server', 'Browser Exam Key belum diatur di perangkat ini.\n\nMode operator → Set/ganti Browser Exam Key.');
      return;
    }
    final deviceFp = ConfigStore.fingerprint(key);
    final url = '$_base/api/seb/self-test';
    final hash = sha256.convert(utf8.encode(url + key)).toString();
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 12);
    try {
      final request = await client.getUrl(Uri.parse(url));
      request.headers.set('X-SafeExamBrowser-RequestHash', hash);
      request.headers.set('Accept', 'application/json');
      final response = await request.close();
      final body = await utf8.decodeStream(response);
      if (!mounted) return;
      Map<String, dynamic>? json;
      try {
        json = jsonDecode(body) as Map<String, dynamic>?;
      } catch (_) {
        json = null;
      }
      final serverFps = (json?['fingerprints'] as List?)?.cast<String>() ?? const [];
      final status = json?['status']?.toString() ?? 'HTTP ${response.statusCode}';
      if (response.statusCode == 200) {
        await _infoDialog(
          'Key cocok ✓',
          'Perangkat ini bisa mengerjakan sesi wajib SEB.\n\nSidik jari perangkat: $deviceFp\nSidik jari server: ${serverFps.join(', ')}',
        );
      } else if (response.statusCode == 503) {
        await _infoDialog(
          'Server belum siap',
          '${json?['message'] ?? 'SEB_BROWSER_EXAM_KEY belum diisi di server.'}\n\nSidik jari perangkat: $deviceFp',
        );
      } else {
        await _infoDialog(
          'Key TIDAK cocok',
          'Hash tidak cocok dengan SEB_BROWSER_EXAM_KEY di server.\n\n'
              'Sidik jari perangkat: $deviceFp\n'
              'Sidik jari server: ${serverFps.isEmpty ? '(tidak tersedia)' : serverFps.join(', ')}\n\n'
              'Ganti key di mode operator, lalu uji lagi.',
        );
      }
      // status hanya untuk fallback tampilan
      assert(status.isNotEmpty);
    } on SocketException catch (e) {
      if (mounted) await _infoDialog('Tidak bisa terhubung', 'Periksa koneksi internet/server.\n\n${e.message}');
    } catch (e) {
      if (mounted) await _infoDialog('Gagal menguji key', 'Terjadi kesalahan: $e');
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _infoDialog(String title, String message) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message, style: const TextStyle(height: 1.45)),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Tutup')),
        ],
      ),
    );
  }

  Future<void> _maximizeAlarmVolume() async {
    try {
      await _kioskChannel.invokeMethod<bool>('maximizeAlarmVolume');
    } catch (_) {
      // Channel tidak tersedia — abaikan.
    }
  }

  Future<void> _onBridgeMessage(JavaScriptMessage message) async {
    Map<String, dynamic>? payload;
    try {
      payload = jsonDecode(message.message) as Map<String, dynamic>?;
    } catch (_) {
      return;
    }
    if (payload == null) return;
    if (payload['type'] == 'maximizeVolume') {
      await _maximizeAlarmVolume();
      return;
    }
    // Pesan alarm (pelanggaran dari web: keluar tab, fullscreen exit, dll.)
    if (payload['type'] == 'alarm') {
      try {
        await _kioskChannel.invokeMethod('playAlarm');
      } catch (_) {
        // Native channel tidak tersedia — abaikan.
      }
      return;
    }
    final id = (payload['id']?.toString() ?? '').replaceAll(RegExp(r'[^a-z0-9_]'), '');
    final url = payload['url']?.toString() ?? '';
    if (id.isEmpty || url.isEmpty || url.length > 8192 || !_isSameOriginString(url)) return;
    final key = await _store.examKey();
    if (key == null || key.isEmpty) return;
    final hash = sha256.convert(utf8.encode(url + key)).toString();
    unawaited(_controller.runJavaScript('window.__sebBridgeDone("$id", "$hash");'));
  }

  /// Pengaturan khusus WebView Android (di luar API lintas-platform):
  /// overscroll glow dimatikan → scroll terasa lebih ringan & responsif saat
  /// digeser; konten HTTP dari origin HTTPS dilarang; fitur yang tidak dipakai
  /// (geolocation, akses file/content, Payment Request, WebAuthn) dimatikan.
  Future<void> _applyAndroidWebSettings() async {
    final platform = _controller.platform;
    if (platform is! AndroidWebViewController) return;
    try {
      await platform.setOverScrollMode(WebViewOverScrollMode.never);
      await platform.setMixedContentMode(MixedContentMode.neverAllow);
      await platform.setGeolocationEnabled(false);
      await platform.setAllowFileAccess(false);
      await platform.setAllowContentAccess(false);
      await platform.setUseWideViewPort(true);
      await platform.setTextZoom(100);
      await platform.setPaymentRequestEnabled(false);
      await platform.setWebAuthenticationSupport(WebAuthenticationSupport.none);
    } catch (_) {
      // Perangkat dengan WebView lama yang menolak pengaturan — abaikan.
    }
  }

  WebViewController _buildController() {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF050B16))
      ..enableZoom(false)
      ..addJavaScriptChannel(
        'SebBridgeNative',
        onMessageReceived: (message) => unawaited(_onBridgeMessage(message)),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            if (request.isMainFrame && !_isSameOriginString(request.url)) {
              _toast('Hanya aplikasi CBT resmi yang diizinkan.');
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
          onPageStarted: (_) => setState(() {
                _progress = 0;
                _fatal = false;
                _webReady = false;
              }),
          onProgress: (progress) {
            final quantized = (progress ~/ 10) * 10;
            if (quantized != _progress) setState(() => _progress = quantized);
          },
          onPageFinished: (_) async {
            try {
              await _controller.runJavaScript(kBridgePolyfill);
            } catch (_) {
              // Halaman mungkin sudah berpindah — abaikan.
            }
            unawaited(_maximizeAlarmVolume());
            // Cold start: aplikasi dibuka lagi setelah keluar/dibunuh —
            // paksa login ulang (token apa pun yang tersisa dibersihkan).
            if (_coldStart) {
              _coldStart = false;
              unawaited(_forceRelogin());
            }
            if (mounted) setState(() => _webReady = true);
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame ?? true) {
              setState(() {
                _fatal = true;
                _fatalDesc = error.description;
                _webReady = true;
              });
            }
          },
        ),
      )
      ..loadRequest(Uri.parse(_base));
    return controller;
  }

  /* -------------------- operator: hot corner + PIN -------------------- */

  void _onCornerTap() {
    final now = DateTime.now();
    // Jendela sedikit lebar — HP low-end (WebView berat) ketukannya lebih lambat.
    if (_lastCornerTap != null && now.difference(_lastCornerTap!) > const Duration(milliseconds: 1500)) {
      _cornerTaps = 0;
    }
    _lastCornerTap = now;
    _cornerTaps += 1;
    if (_cornerTaps >= 7) {
      _cornerTaps = 0;
      unawaited(_promptOperatorPin());
    }
  }

  Future<void> _promptOperatorPin() async {
    final pin = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Mode operator'),
        content: TextField(
          controller: pin,
          obscureText: true,
          autofocus: true,
          autocorrect: false,
          enableSuggestions: false,
          autofillHints: const [],
          decoration: const InputDecoration(labelText: 'PIN operator'),
          onSubmitted: (_) => Navigator.of(dialogContext).pop(pin.text == kOperatorPin),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Batal')),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(pin.text == kOperatorPin),
            child: const Text('Masuk'),
          ),
        ],
      ),
    );
    if (result == true) {
      if (mounted) await _openAdminMenu();
    } else if (result == false && pin.text.isNotEmpty) {
      _toast('PIN operator salah.');
    }
  }

  /// Dialog PIN keluar — PIN diatur admin di web: Pengaturan → "PIN Keluar
  /// APK SEB". Diverifikasi ke server, bukan tersimpan di perangkat.
  Future<void> _promptExitPin() async {
    final pin = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Keluar aplikasi'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Masukkan PIN keluar yang diatur admin sekolah.\n\n'
              'PIN disimpan sebagai hash di server — perangkat ini tidak menyimpannya.',
              style: TextStyle(color: Color(0xFF8A97AD), height: 1.45),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: pin,
              obscureText: true,
              autofocus: true,
              autocorrect: false,
              enableSuggestions: false,
              autofillHints: const [],
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.go,
              decoration: const InputDecoration(labelText: 'PIN keluar'),
              onSubmitted: (_) => Navigator.of(dialogContext).pop(pin.text.trim()),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Batal')),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(pin.text.trim()),
            child: const Text('Keluar'),
          ),
        ],
      ),
    );
    if (result == null) return;
    if (result.isEmpty) {
      _toast('PIN tidak boleh kosong.');
      return;
    }
    await _verifyExitPin(result);
  }

  /// Verifikasi PIN keluar ke server (`POST /api/seb/exit-verify`, publik).
  /// Fail-closed: tanpa jaringan/lolos verifikasi, aplikasi TIDAK tertutup.
  Future<void> _verifyExitPin(String pin) async {
    final url = '$_base/api/seb/exit-verify';
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    try {
      final request = await client.postUrl(Uri.parse(url));
      request.headers.contentType = ContentType('application', 'json', charset: 'utf-8');
      request.headers.set('Accept', 'application/json');
      request.add(utf8.encode(jsonEncode({'pin': pin})));
      final response = await request.close();
      final body = await utf8.decodeStream(response);
      if (!mounted) return;
      Map<String, dynamic>? json;
      try {
        json = jsonDecode(body) as Map<String, dynamic>?;
      } catch (_) {
        json = null;
      }
      if (response.statusCode == 429) {
        await _infoDialog('Terlalu banyak percobaan', 'PIN salah berkali-kali. Tunggu 5 menit, lalu coba lagi.');
        return;
      }
      if (response.statusCode == 200 && json?['ok'] == true) {
        await _exitApp();
        return;
      }
      if (json?['configured'] == false) {
        await _infoDialog(
          'PIN keluar belum diatur',
          'Admin sekolah belum mengatur "PIN Keluar APK SEB" di menu Pengaturan.\n\n'
              'Tanpa PIN itu, aplikasi tidak bisa ditutup dari perangkat ini.',
        );
        return;
      }
      await _infoDialog('PIN salah', json?['message']?.toString() ?? 'PIN keluar tidak cocok. Minta PIN ke admin sekolah.');
    } on SocketException catch (e) {
      if (mounted) {
        await _infoDialog(
          'Tidak bisa terhubung',
          'PIN keluar diverifikasi ke server — periksa koneksi internet/server, lalu coba lagi.\n\n${e.message}',
        );
      }
    } catch (e) {
      if (mounted) await _infoDialog('Gagal memverifikasi PIN', 'Terjadi kesalahan: $e');
    } finally {
      client.close(force: true);
    }
  }

  /// Tutup aplikasi dengan rapi: lepas screen pinning DULU (agar onPause
  /// setelahnya tidak membunyikan alarm/mencatat pelanggaran palsu).
  Future<void> _exitApp() async {
    _exitInProgress = true;
    try {
      await _kioskChannel.invokeMethod('stopLockTask');
    } catch (_) {
      // Channel tidak tersedia — tetap keluar.
    }
    await SystemNavigator.pop();
  }

  Future<void> _openAdminMenu() async {
    final fingerprint = await _store.examKeyFingerprint();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF0D1729),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 8),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text('Mode operator', style: TextStyle(color: Color(0xFFE8EEF7), fontWeight: FontWeight.w800, fontSize: 16)),
            ),
            ListTile(
              leading: const Icon(Icons.link),
              title: const Text('Base URL server'),
              subtitle: Text(
                _base,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Color(0xFF8A97AD)),
              ),
              onTap: () async {
                Navigator.of(sheetContext).pop();
                await _editBaseUrl();
              },
            ),
            ListTile(
              leading: const Icon(Icons.key_outlined),
              title: const Text('Set / ganti Browser Exam Key'),
              subtitle: Text(
                fingerprint == null ? 'Belum diatur' : 'Sidik jari: $fingerprint',
                style: const TextStyle(color: Color(0xFF8A97AD)),
              ),
              onTap: () async {
                Navigator.of(sheetContext).pop();
                await _editExamKey();
              },
            ),
            ListTile(
              leading: const Icon(Icons.wifi_tethering),
              title: const Text('Uji key ke server'),
              subtitle: const Text(
                'Cek cocok/tidaknya key dengan server (tanpa login)',
                style: TextStyle(color: Color(0xFF8A97AD)),
              ),
              onTap: () async {
                Navigator.of(sheetContext).pop();
                await _runSelfTest();
              },
            ),
            SwitchListTile(
              secondary: const Icon(Icons.lock_rounded),
              title: const Text('Kunci layar (screen pinning)'),
              subtitle: const Text(
                'Home/Recents/notifikasi terkunci saat ujian. '
                'Lepas: tahan tombol Recents + Kembali (+PIN layar).',
                style: TextStyle(color: Color(0xFF8A97AD)),
              ),
              value: _lockTaskEnabled,
              onChanged: (value) async {
                await _store.saveLockTask(value);
                await _syncLockTask();
                if (mounted) _toast(value ? 'Kunci layar aktif.' : 'Kunci layar nonaktif.');
              },
            ),
            ListTile(
              leading: const Icon(Icons.key_off_outlined),
              title: const Text('Hapus Browser Exam Key'),
              onTap: () async {
                Navigator.of(sheetContext).pop();
                await _store.clearExamKey();
                if (mounted) _toast('Browser Exam Key dihapus.');
              },
            ),
            ListTile(
              leading: const Icon(Icons.power_settings_new_rounded, color: Color(0xFFFF6B6B)),
              title: const Text('Keluar aplikasi', style: TextStyle(color: Color(0xFFFF6B6B))),
              subtitle: const Text(
                'Butuh PIN keluar yang diatur admin sekolah',
                style: TextStyle(color: Color(0xFF8A97AD)),
              ),
              onTap: () async {
                Navigator.of(sheetContext).pop();
                await _promptExitPin();
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _editBaseUrl() async {
    final controller = TextEditingController(text: _base);
    final saved = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Base URL server CBT'),
        content: TextField(
          controller: controller,
          autofocus: true,
          autocorrect: false,
          enableSuggestions: false,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(hintText: 'https://cbt.sman1gorontalo.sch.id'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Batal')),
          TextButton(
            onPressed: () {
              final normalized = ConfigStore.normalizeBaseUrl(controller.text);
              if (normalized == null) {
                _toast('URL tidak valid.');
                return;
              }
              Navigator.of(dialogContext).pop(normalized);
            },
            child: const Text('Simpan'),
          ),
        ],
      ),
    );
    if (saved != null && saved != _base) {
      await _store.saveBaseUrl(saved);
      if (mounted) widget.onConfigChanged();
    }
  }

  Future<void> _editExamKey() async {
    final controller = TextEditingController();
    final saved = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Browser Exam Key'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Harus sama persis dengan SEB_BROWSER_EXAM_KEY di server (.env). '
              'Key disimpan terenkripsi di perangkat dan tidak pernah ditampilkan lagi.',
              style: TextStyle(color: Color(0xFF8A97AD), height: 1.4),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              obscureText: true,
              autofocus: true,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(labelText: 'Exam key baru'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Batal')),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Simpan'),
          ),
        ],
      ),
    );
    if (saved != null && saved.isNotEmpty) {
      try {
        await _store.saveExamKey(saved);
        final fp = ConfigStore.fingerprint(saved);
        if (mounted) _toast('Key tersimpan. Sidik jari: $fp');
      } on FormatException catch (e) {
        if (mounted) _toast(e.message);
      }
    }
  }

  /// Tombol mengambang bulat (Refresh / Keluar) — mengikuti gaya yang sama.
  Widget _roundFab({
    required VoidCallback onPressed,
    VoidCallback? onLongPress,
    required IconData icon,
    required Color color,
    required String tooltip,
    required bool alignLeft,
  }) {
    return Positioned(
      left: alignLeft ? 14 : null,
      right: alignLeft ? null : 14,
      bottom: 18,
      child: Material(
        color: Colors.transparent,
        shape: const CircleBorder(),
        child: Ink(
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.80),
            shape: BoxShape.circle,
            boxShadow: const [
              BoxShadow(color: Colors.black45, blurRadius: 8, offset: Offset(0, 2)),
            ],
          ),
          child: IconButton(
            tooltip: tooltip,
            icon: Icon(icon, color: Colors.white),
            onPressed: onPressed,
            onLongPress: onLongPress,
          ),
        ),
      ),
    );
  }

  /* ------------------------------ build ------------------------------ */

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        // Back fisik tidak menutup aplikasi — bila keyboard terbuka, tutup keyboard saja.
        FocusScope.of(context).unfocus();
      },
      child: Scaffold(
        body: Stack(
          children: [
            Positioned.fill(
              child: ColoredBox(
                color: const Color(0xFF050B16),
                child: WebViewWidget(controller: _controller),
              ),
            ),
            if (!_fatal && !(_webReady && _minSplashElapsed))
              Positioned.fill(
                child: SplashView(progress: (_webReady ? 100 : _progress) / 100),
              ),
            if (_progress < 100 && _webReady)
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: LinearProgressIndicator(
                  value: _progress / 100,
                  minHeight: 2,
                  backgroundColor: Colors.transparent,
                  color: const Color(0xFFFFC53D),
                ),
              ),
            if (_fatal)
              Positioned.fill(
                child: ColoredBox(
                  color: const Color(0xFF050B16),
                  child: SafeArea(
                    child: Center(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(32),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 420),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              // Ikon status dalam cincin brand
                              Container(
                                padding: const EdgeInsets.all(18),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: const Color(0xFF1B7FE0).withValues(alpha: 0.12),
                                  border: Border.all(color: const Color(0xFF1B7FE0).withValues(alpha: 0.45), width: 1.5),
                                ),
                                child: const Icon(Icons.wifi_off_rounded, size: 44, color: Color(0xFF5EA8F0)),
                              ),
                              const SizedBox(height: 18),
                              const Text(
                                'Tidak dapat memuat CBT',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: Color(0xFFE8EEF7), fontSize: 20, fontWeight: FontWeight.w800),
                              ),
                              const SizedBox(height: 6),
                              const Text(
                                'Aplikasi tidak bisa terhubung ke server ujian.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: Color(0xFF8A97AD), height: 1.4),
                              ),
                              const SizedBox(height: 14),
                              // Base URL yang dicoba (supaya operator langsung tahu)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF0D1729),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.link_rounded, size: 15, color: Color(0xFF8A97AD)),
                                    const SizedBox(width: 8),
                                    Flexible(
                                      child: SelectableText(
                                        _base,
                                        textAlign: TextAlign.center,
                                        style: const TextStyle(color: Color(0xFFC7D3E6), fontSize: 12.5),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 10),
                              if (_fatalDesc != null && _fatalDesc!.isNotEmpty)
                                Text(
                                  _fatalDesc!,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(color: Color(0xFF6B7A93), fontSize: 12, height: 1.4),
                                ),
                              const SizedBox(height: 22),
                              SizedBox(
                                width: 230,
                                height: 48,
                                child: ElevatedButton.icon(
                                  onPressed: _reload,
                                  icon: const Icon(Icons.refresh),
                                  label: const Text('COBA LAGI'),
                                ),
                              ),
                              const SizedBox(height: 10),
                              SizedBox(
                                width: 230,
                                height: 46,
                                child: OutlinedButton.icon(
                                  onPressed: () => unawaited(_promptExitPin()),
                                  icon: const Icon(Icons.power_settings_new_rounded, color: Color(0xFFFF8A8A)),
                                  style: OutlinedButton.styleFrom(
                                    side: BorderSide(color: const Color(0xFFFF6B6B).withValues(alpha: 0.55)),
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                  ),
                                  label: const Text('KELUAR (PIN ADMIN)', style: TextStyle(color: Color(0xFFFF8A8A), letterSpacing: 0.8)),
                                ),
                              ),
                              const SizedBox(height: 20),
                              const Text(
                                'Pastikan HP dan server berada di jaringan yang sama.\nOperator: 7× ketuk sudut kiri atas untuk mengubah Base URL.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: Color(0xFF5B6B84), fontSize: 11, height: 1.5),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            // Tombol keluar (butuh PIN admin) — selalu terlihat di kiri bawah.
            _roundFab(
              onPressed: () => unawaited(_promptExitPin()),
              icon: Icons.power_settings_new_rounded,
              color: const Color(0xFF7F1D1D),
              tooltip: 'Keluar aplikasi (PIN admin)',
              alignLeft: true,
            ),
            // Tombol refresh selalu ada di kanan bawah (di setiap halaman).
            // Tahan ±2 detik → mode operator (gerbang PIN yang sama).
            _roundFab(
              onPressed: _refreshPage,
              onLongPress: () => unawaited(_promptOperatorPin()),
              icon: Icons.refresh_rounded,
              color: const Color(0xFF1B7FE0),
              tooltip: 'Muat ulang halaman',
              alignLeft: false,
            ),
            // Hot corner operator: tidak terlihat, 7 ketukan membuka PIN.
            Positioned(
              top: 0,
              left: 0,
              width: 72,
              height: 72,
              child: GestureDetector(behavior: HitTestBehavior.translucent, onTap: _onCornerTap),
            ),
          ],
        ),
      ),
    );
  }
}
