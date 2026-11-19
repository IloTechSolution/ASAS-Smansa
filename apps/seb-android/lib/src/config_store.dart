import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SebConfig {
  const SebConfig({this.baseUrl, this.examKey});

  final String? baseUrl;
  final String? examKey;

  bool get isReady => (baseUrl ?? '').isNotEmpty;
}

class ConfigStore {
  static const _kBaseUrl = 'seb.baseUrl';
  static const _kExamKey = 'seb.examKey';
  static const _kLockTask = 'seb.lockTask';
  static const _storage = FlutterSecureStorage();

  /// Normalisasi input operator → `scheme://host[:port][/path]` tanpa query/fragment
  /// dan tanpa slash di akhir. Mengembalikan null bila tidak valid.
  ///
  /// Bila skema tidak ditulis: host LAN (IP privat / localhost) di-default ke
  /// `http://` (server lab sering tanpa TLS), selain itu `https://`.
  static String? normalizeBaseUrl(String input) {
    final raw = input.trim();
    if (raw.isEmpty) return null;
    final withScheme = RegExp(r'^https?://', caseSensitive: false).hasMatch(raw)
        ? raw
        : (isLanHost(raw) ? 'http://$raw' : 'https://$raw');
    final uri = Uri.tryParse(withScheme);
    if (uri == null || !uri.hasAuthority || uri.host.isEmpty) return null;
    var path = uri.path;
    if (path.endsWith('/')) path = path.substring(0, path.length - 1);
    final port = uri.hasPort ? ':${uri.port}' : '';
    return '${uri.scheme}://${uri.host}$port$path';
  }

  static bool isValidBaseUrl(String input) => normalizeBaseUrl(input) != null;

  /// Host IP privat / localhost — dipakai untuk default `http://` (LAN lab).
  /// Contoh valid: 10.x, 127.x, 192.168.x, 172.16–172.31.x, localhost, [::1].
  static bool isLanHost(String hostPortPath) {
    final noPath = hostPortPath.split('/').first.trim().toLowerCase();
    if (noPath == 'localhost' || noPath.startsWith('localhost:')) return true;
    if (noPath == '[::1]' || noPath.startsWith('[::1]:') || noPath == '::1') return true;
    final host = noPath.split(':').first;
    final parts = host.split('.');
    if (parts.length != 4) return false;
    final nums = parts.map(int.tryParse).toList();
    if (nums.any((n) => n == null || n < 0 || n > 255)) return false;
    final a = nums[0]!;
    final b = nums[1]!;
    return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
  }

  /// Tampilkan sidik jari (bukan isi) Browser Exam Key untuk dicocokkan dengan
  /// server — operator memverifikasi bahwa key di HP sama dengan yang terdaftar.
  static String? fingerprint(String? examKey) {
    final key = examKey?.trim();
    if (key == null || key.isEmpty) return null;
    return sha256.convert(utf8.encode(key)).toString().substring(0, 8);
  }

  Future<SebConfig> load() async {
    return SebConfig(
      baseUrl: (await _storage.read(key: _kBaseUrl))?.trim(),
      examKey: (await _storage.read(key: _kExamKey))?.trim(),
    );
  }

  Future<void> saveBaseUrl(String url) async {
    final normalized = normalizeBaseUrl(url);
    if (normalized == null) {
      throw const FormatException('URL tidak valid. Contoh: https://cbt.sman1gorontalo.sch.id');
    }
    await _storage.write(key: _kBaseUrl, value: normalized);
  }

  Future<void> saveExamKey(String key) async {
    final clean = key.trim();
    if (clean.length < 16) {
      throw const FormatException('Browser Exam Key minimal 16 karakter.');
    }
    await _storage.write(key: _kExamKey, value: clean);
  }

  Future<void> clearExamKey() async => _storage.delete(key: _kExamKey);

  /// Screen pinning (kunci layar) — default AKTIF. Berlaku untuk layar kiosk.
  Future<bool> lockTask() async {
    final raw = (await _storage.read(key: _kLockTask))?.trim().toLowerCase();
    if (raw == null) return true;
    return raw == 'true' || raw == '1' || raw == 'yes';
  }

  Future<void> saveLockTask(bool enabled) async =>
      _storage.write(key: _kLockTask, value: enabled ? 'true' : 'false');

  Future<String?> examKey() async => (await _storage.read(key: _kExamKey))?.trim();

  Future<String?> examKeyFingerprint() async => fingerprint(await examKey());

  static Uri originOf(String baseUrl) {
    final u = Uri.parse(baseUrl);
    return Uri(scheme: u.scheme, host: u.host, port: u.hasPort ? u.port : null);
  }
}
