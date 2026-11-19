import 'package:flutter/material.dart';

import '../config_store.dart';
import '../widgets/splash_view.dart';
import 'kiosk_screen.dart';
import 'setup_screen.dart';

class BootScreen extends StatefulWidget {
  const BootScreen({super.key});

  @override
  State<BootScreen> createState() => _BootScreenState();
}

class _BootScreenState extends State<BootScreen> {
  late Future<SebConfig> _future;

  /// Splash minimal tampil — layar merek tidak sekadar kedip lalu hilang.
  bool _minElapsed = false;

  @override
  void initState() {
    super.initState();
    _future = ConfigStore().load();
    Future<void>.delayed(const Duration(milliseconds: 900), () {
      if (mounted) setState(() => _minElapsed = true);
    });
  }

  void _reload() {
    setState(() => _future = ConfigStore().load());
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<SebConfig>(
      future: _future,
      builder: (context, snap) {
        if (!_minElapsed || snap.connectionState != ConnectionState.done) {
          return const SplashView();
        }
        final cfg = snap.data ?? const SebConfig();
        if (cfg.isReady) {
          return KioskScreen(
            key: ValueKey(cfg.baseUrl),
            config: cfg,
            onConfigChanged: _reload,
          );
        }
        return SetupScreen(onSaved: _reload);
      },
    );
  }
}
