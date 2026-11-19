import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Layar splash bermerek: dipakai BootScreen (memuat konfigurasi) dan kiosk
/// (memuat halaman) agar transisi app terasa satu kesatuan yang profesional.
/// `progress` null = indeterminate (shimmer); 0..1 = determinate.
class SplashView extends StatefulWidget {
  const SplashView({super.key, this.progress});

  final double? progress;

  @override
  State<SplashView> createState() => _SplashViewState();
}

class _SplashViewState extends State<SplashView> with TickerProviderStateMixin {
  late final AnimationController _enter;
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _enter = AnimationController(vsync: this, duration: const Duration(milliseconds: 1150))..forward();
    _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400))..repeat(reverse: true);
  }

  @override
  void dispose() {
    _enter.dispose();
    _pulse.dispose();
    super.dispose();
  }

  Animation<double> _interval(double begin, double end) =>
      CurvedAnimation(parent: _enter, curve: Interval(begin, end, curve: Curves.easeOutCubic));

  Widget _rise(double begin, double end, Widget child, {double dy = 12}) => FadeTransition(
        opacity: _interval(begin, end),
        child: AnimatedBuilder(
          animation: _enter,
          builder: (context, _) {
            final t = _interval(begin, end).value;
            return Transform.translate(offset: Offset(0, (1 - t) * dy), child: child);
          },
          child: child,
        ),
      );

  @override
  Widget build(BuildContext context) {
    const bg = Color(0xFF050B16);
    const brand = Color(0xFF1B7FE0);
    const gold = Color(0xFFFFC53D);
    const text = Color(0xFFE8EEF7);
    const muted = Color(0xFF8A97AD);

    return Semantics(
      label: 'Memuat SEB SMAN 1 Gorontalo',
      child: ColoredBox(
        color: bg,
        child: Stack(
          fit: StackFit.expand,
          children: [
            // Glow biru (kiri atas) — echo aurora login page.
            const _Glow(alignment: Alignment(-1.15, -1.05), color: brand, alpha: 0.20, radius: 1.05),
            // Glow indigo (kanan bawah).
            const _Glow(alignment: Alignment(1.15, 0.95), color: Color(0xFF6366F1), alpha: 0.14, radius: 1.05),
            // Aura emas halus di balik logo.
            const _Glow(alignment: Alignment(0, -0.18), color: gold, alpha: 0.07, radius: 0.42),
            // Watermark "SEB" samar di kanan bawah.
            Positioned(
              right: -10,
              bottom: -22,
              child: Text(
                'SEB',
                style: TextStyle(
                  fontFamily: 'PlusJakartaSans',
                  fontWeight: FontWeight.w800,
                  fontSize: 150,
                  letterSpacing: 10,
                  color: Colors.white.withValues(alpha: 0.025),
                  height: 1,
                ),
              ),
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 36),
                child: Stack(
                  children: [
                    Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 430),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            // Logo + cincin pemindai.
                            ScaleTransition(
                              scale: CurvedAnimation(parent: _enter, curve: Interval(0.0, 0.7, curve: Curves.easeOutBack)),
                              child: FadeTransition(
                                opacity: _interval(0.0, 0.55),
                                child: SizedBox(
                                  width: 168,
                                  height: 168,
                                  child: Stack(
                                    alignment: Alignment.center,
                                    children: [
                                      AnimatedBuilder(
                                        animation: _pulse,
                                        builder: (context, _) => CustomPaint(
                                          size: const Size(168, 168),
                                          painter: _RingPainter(sweep: _pulse.value, brand: brand),
                                        ),
                                      ),
                                      Container(
                                        width: 128,
                                        height: 128,
                                        decoration: BoxDecoration(
                                          shape: BoxShape.circle,
                                          color: const Color(0xFF0D1729),
                                          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                                          boxShadow: [
                                            BoxShadow(color: brand.withValues(alpha: 0.35 + _pulse.value * 0.12), blurRadius: 44, spreadRadius: 2),
                                          ],
                                        ),
                                      ),
                                      ClipOval(
                                        child: Image.asset(
                                          'assets/icon.png',
                                          width: 96,
                                          height: 96,
                                          fit: BoxFit.contain,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 26),
                            _rise(0.22, 0.72, Text(
                              'S M A N   1   G O R O N T A L O',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontFamily: 'PlusJakartaSans',
                                fontWeight: FontWeight.w700,
                                fontSize: 11.5,
                                letterSpacing: 4.2,
                                color: gold,
                              ),
                            )),
                            const SizedBox(height: 10),
                            _rise(0.30, 0.78, const Text(
                              'SEB',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontFamily: 'PlusJakartaSans',
                                fontWeight: FontWeight.w800,
                                fontSize: 92,
                                letterSpacing: 26,
                                color: text,
                                height: 1.05,
                              ),
                            )),
                            const SizedBox(height: 14),
                            _rise(0.38, 0.84, Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Container(width: 52, height: 1, decoration: _fadeLine(reverse: true)),
                                const SizedBox(width: 10),
                                Transform.rotate(
                                  angle: math.pi / 4,
                                  child: Container(width: 5.5, height: 5.5, color: gold),
                                ),
                                const SizedBox(width: 10),
                                Container(width: 52, height: 1, decoration: _fadeLine(reverse: false)),
                              ],
                            )),
                            const SizedBox(height: 12),
                            _rise(0.46, 0.9, ShaderMask(
                              shaderCallback: (bounds) => const LinearGradient(
                                colors: [Color(0xFFE8EEF7), Color(0xFFE8EEF7), Color(0xFFFFE28A), Color(0xFFC9BCFF)],
                                stops: [0.0, 0.55, 0.78, 1.0],
                              ).createShader(bounds),
                              child: const Text(
                                'Ujian yang jujur, dikerjakan dengan tenang.',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontFamily: 'Fraunces',
                                  fontStyle: FontStyle.italic,
                                  fontWeight: FontWeight.w300,
                                  fontSize: 15.5,
                                  height: 1.35,
                                  color: Colors.white,
                                ),
                              ),
                            )),
                            const SizedBox(height: 44),
                            _rise(0.54, 0.97, Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                _ProgressLine(progress: widget.progress, brand: brand, gold: gold),
                                const SizedBox(height: 12),
                                Text(
                                  widget.progress == null ? 'M E M U A T …' : 'M E M U A T   ${(widget.progress! * 100).round()}%',
                                  style: const TextStyle(
                                    fontFamily: 'PlusJakartaSans',
                                    fontWeight: FontWeight.w600,
                                    fontSize: 10,
                                    letterSpacing: 3.4,
                                    color: muted,
                                  ),
                                ),
                              ],
                            )),
                          ],
                        ),
                      ),
                    ),
                    // Footer pinned di bawah.
                    Align(
                      alignment: Alignment.bottomCenter,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.shield_outlined, size: 11, color: Colors.white.withValues(alpha: 0.28)),
                                const SizedBox(width: 6),
                                Text(
                                  'TERENKRIPSI  &  AMAN',
                                  style: TextStyle(
                                    fontFamily: 'PlusJakartaSans',
                                    fontWeight: FontWeight.w600,
                                    fontSize: 8.5,
                                    letterSpacing: 2.6,
                                    color: Colors.white.withValues(alpha: 0.30),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'COMPUTER  BASED  TEST',
                              style: TextStyle(
                                fontFamily: 'PlusJakartaSans',
                                fontWeight: FontWeight.w700,
                                fontSize: 10,
                                letterSpacing: 5,
                                color: Colors.white.withValues(alpha: 0.34),
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              'TAHUN AJARAN 2026/2027',
                              style: TextStyle(
                                fontFamily: 'PlusJakartaSans',
                                fontWeight: FontWeight.w700,
                                fontSize: 8.5,
                                letterSpacing: 3,
                                color: gold.withValues(alpha: 0.55),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static BoxDecoration _fadeLine({required bool reverse}) => BoxDecoration(
        gradient: LinearGradient(
          colors: const [Colors.transparent, Color(0xFFFFC53D)],
          begin: reverse ? Alignment.centerLeft : Alignment.centerRight,
          end: reverse ? Alignment.centerRight : Alignment.centerLeft,
        ),
      );
}

class _Glow extends StatelessWidget {
  const _Glow({required this.alignment, required this.color, required this.alpha, required this.radius});

  final Alignment alignment;
  final Color color;
  final double alpha;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: alignment,
      child: IgnorePointer(
        child: FractionallySizedBox(
          widthFactor: radius * 2,
          heightFactor: radius * 2,
          child: DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [color.withValues(alpha: alpha), color.withValues(alpha: 0.0)],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.sweep, required this.brand});

  /// Nilai 0..1 (bolak-balik) — mengendalikan rotasi busur pemindai.
  final double sweep;
  final Color brand;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final radius = size.width / 2 - 6;
    // Cincin dasar (hairline).
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.1
      ..color = Colors.white.withValues(alpha: 0.10);
    canvas.drawCircle(center, radius, base);

    // Busur pemindai berputar — gradien kuat-ke-pudar.
    final start = sweep * 2 * math.pi;
    const arcSweep = math.pi * 0.62;
    final segments = 24;
    for (var i = 0; i < segments; i += 1) {
      final f = i / segments;
      final segStart = start + f * arcSweep;
      final segEnd = start + (f + 1 / segments) * arcSweep;
      final seg = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6
        ..strokeCap = StrokeCap.round
        ..color = brand.withValues(alpha: 0.9 * (1 - f));
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        segStart,
        segEnd - segStart,
        false,
        seg,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RingPainter oldDelegate) => oldDelegate.sweep != sweep;
}

class _ProgressLine extends StatefulWidget {
  const _ProgressLine({required this.progress, required this.brand, required this.gold});

  final double? progress;
  final Color brand;
  final Color gold;

  @override
  State<_ProgressLine> createState() => _ProgressLineState();
}

class _ProgressLineState extends State<_ProgressLine> with SingleTickerProviderStateMixin {
  late final AnimationController _shimmer;

  @override
  void initState() {
    super.initState();
    _shimmer = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();
  }

  @override
  void dispose() {
    _shimmer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const height = 3.0;
    const width = 168.0;
    if (widget.progress != null) {
      return SizedBox(
        width: width,
        height: height,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(2),
          child: Stack(
            fit: StackFit.expand,
            children: [
              ColoredBox(color: Colors.white.withValues(alpha: 0.10)),
              FractionallySizedBox(
                widthFactor: widget.progress!.clamp(0.0, 1.0),
                alignment: Alignment.centerLeft,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: [widget.brand, widget.gold]),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }
    return SizedBox(
      width: width,
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(2),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ColoredBox(color: Colors.white.withValues(alpha: 0.10)),
            AnimatedBuilder(
              animation: _shimmer,
              builder: (context, _) {
                final x = _shimmer.value * 2.4 - 1.2;
                return FractionallySizedBox(
                  widthFactor: 0.42,
                  alignment: Alignment(x, 0),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          widget.brand.withValues(alpha: 0.0),
                          widget.brand,
                          widget.gold,
                          widget.gold.withValues(alpha: 0.0),
                        ],
                        stops: const [0.0, 0.35, 0.65, 1.0],
                      ),
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
