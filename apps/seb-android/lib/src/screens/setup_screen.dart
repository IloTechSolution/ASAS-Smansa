import 'package:flutter/material.dart';

import '../config_store.dart';

class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, required this.onSaved});

  final VoidCallback onSaved;

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final _url = TextEditingController();
  final _key = TextEditingController();
  final _store = ConfigStore();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _url.dispose();
    _key.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _error = null;
      _busy = true;
    });
    try {
      await _store.saveBaseUrl(_url.text);
      final key = _key.text.trim();
      if (key.isNotEmpty) {
        await _store.saveExamKey(key);
      }
      widget.onSaved();
    } on FormatException catch (e) {
      setState(() {
        _error = e.message;
        _busy = false;
      });
    } catch (_) {
      setState(() {
        _error = 'Gagal menyimpan konfigurasi.';
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    const muted = Color(0xFF8A97AD);
    const gold = Color(0xFFFFC53D);
    return Scaffold(
      backgroundColor: const Color(0xFF050B16),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset('assets/icon.png', width: 96, height: 96),
                  const SizedBox(height: 20),
                  Text(
                    'SEB SMAN 1 Gorontalo',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Konfigurasi operator. Isi sekali saat pemasangan di perangkat sekolah; '
                    'siswa tidak perlu mengisi apa pun.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: muted, height: 1.4),
                  ),
                  const SizedBox(height: 28),
                  TextField(
                    controller: _url,
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: const InputDecoration(
                      labelText: 'Base URL server CBT',
                      hintText: 'https://cbt.sman1gorontalo.sch.id atau http://192.168.x.x:8080',
                      helperText: 'Server lab tanpa HTTPS: tulis http:// + IP PC (contoh http://192.168.1.10:8080)',
                      helperStyle: TextStyle(color: muted),
                      prefixIcon: Icon(Icons.link, color: muted),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _key,
                    autocorrect: false,
                    enableSuggestions: false,
                    obscureText: true,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Browser Exam Key (opsional)',
                      hintText: 'Isi bila ujian mewajibkan SEB',
                      prefixIcon: Icon(Icons.key_outlined, color: muted),
                      helperText: 'Kunci yang sama dengan SEB_BROWSER_EXAM_KEY di server.',
                      helperStyle: TextStyle(color: muted),
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (_key.text.trim().isNotEmpty)
                    Row(
                      children: [
                        const Icon(Icons.fingerprint, size: 14, color: Color(0xFFFFC53D)),
                        const SizedBox(width: 6),
                        Text(
                          'Sidik jari: ${ConfigStore.fingerprint(_key.text.trim())}',
                          style: const TextStyle(color: Color(0xFFFFC53D), fontSize: 12.5, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(width: 8),
                        const Flexible(
                          child: Text(
                            '(samakan dengan server)',
                            style: TextStyle(color: muted, fontSize: 11),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    )
                  else
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF59E0B).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.35)),
                      ),
                      child: const Text(
                        'Tanpa Browser Exam Key, sesi WAJIB SEB tidak bisa dikerjakan di perangkat ini (akan ditolak 400).',
                        style: TextStyle(color: Color(0xFFFCD34D), fontSize: 11.5, height: 1.35),
                      ),
                    ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: Color(0xFFFF6B6B))),
                  ],
                  const SizedBox(height: 22),
                  ElevatedButton(
                    onPressed: _busy ? null : _save,
                    child: _busy
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF1A1206)))
                        : const Text('SIMPAN & MULAI'),
                  ),
                  const SizedBox(height: 18),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.lock_outline, size: 14, color: gold.withValues(alpha: 0.9)),
                      const SizedBox(width: 6),
                      const Text(
                        'Layar ini hanya untuk operator.',
                        style: TextStyle(color: muted, fontSize: 12),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
