import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:seb_cbt/src/widgets/splash_view.dart';

const _fonts = <String, List<String>>{
  'PlusJakartaSans': [
    'assets/fonts/PlusJakartaSans-Regular.ttf',
    'assets/fonts/PlusJakartaSans-SemiBold.ttf',
    'assets/fonts/PlusJakartaSans-Bold.ttf',
    'assets/fonts/PlusJakartaSans-ExtraBold.ttf',
  ],
  'Fraunces': [
    'assets/fonts/Fraunces-LightItalic.ttf',
  ],
};

Future<void> _loadFonts() async {
  for (final entry in _fonts.entries) {
    final loader = FontLoader(entry.key);
    for (final path in entry.value) {
      loader.addFont(rootBundle.load(path));
    }
    await loader.load();
  }
}

void main() {
  setUpAll(_loadFonts);

  testWidgets('splash tampil tanpa exception (indeterminate)', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SplashView()));
    await tester.pump(const Duration(milliseconds: 1600));
    expect(find.byType(SplashView), findsOneWidget);
  });

  testWidgets('splash determinate menampilkan persen', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SplashView(progress: 0.42)));
    await tester.pump(const Duration(milliseconds: 1600));
    expect(find.textContaining('42%'), findsOneWidget);
  });
}
