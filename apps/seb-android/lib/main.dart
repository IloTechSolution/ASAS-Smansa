import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'src/app.dart';
import 'src/config_store.dart';

/// QA seed: hanya aktif bila dibangun dengan --dart-define=QA_BASE_URL=...
/// (opsional QA_EXAM_KEY / QA_LOCK_TASK). Tidak berpengaruh pada APK distribusi.
Future<void> _seedQaConfig() async {
  const qaUrl = String.fromEnvironment('QA_BASE_URL');
  if (qaUrl.isEmpty) return;
  const qaKey = String.fromEnvironment('QA_EXAM_KEY');
  const qaLockTask = String.fromEnvironment('QA_LOCK_TASK', defaultValue: 'true');
  final store = ConfigStore();
  final existing = await store.load();
  if ((existing.baseUrl ?? '').isEmpty) {
    await store.saveBaseUrl(qaUrl);
  }
  if (qaKey.isNotEmpty && (existing.examKey ?? '').isEmpty) {
    await store.saveExamKey(qaKey);
  }
  await store.saveLockTask(qaLockTask.toLowerCase() != 'false');
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await _seedQaConfig();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF050B16),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const SebCbtApp());
}
