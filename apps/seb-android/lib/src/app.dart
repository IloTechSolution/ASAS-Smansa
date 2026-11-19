import 'package:flutter/material.dart';

import 'screens/boot_screen.dart';

class SebCbtApp extends StatelessWidget {
  const SebCbtApp({super.key});

  @override
  Widget build(BuildContext context) {
    const bg = Color(0xFF050B16);
    const panel = Color(0xFF0D1729);
    const brand = Color(0xFF1B7FE0);
    const gold = Color(0xFFFFC53D);
    const text = Color(0xFFE8EEF7);
    return MaterialApp(
      title: 'SEB SMAN 1 Gorontalo',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: bg,
        colorScheme: const ColorScheme.dark(
          primary: brand,
          secondary: gold,
          surface: panel,
          onSurface: text,
          onPrimary: Colors.white,
          onSecondary: Color(0xFF1A1206),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFF111E35),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide.none,
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: brand, width: 1.5),
          ),
          labelStyle: const TextStyle(color: Color(0xFF8A97AD)),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: gold,
            foregroundColor: const Color(0xFF1A1206),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            minimumSize: const Size.fromHeight(48),
            textStyle: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: 0.6),
          ),
        ),
        textTheme: const TextTheme(
          headlineMedium: TextStyle(color: text, fontWeight: FontWeight.w800),
          bodyLarge: TextStyle(color: text),
          bodyMedium: TextStyle(color: text),
        ),
      ),
      home: const BootScreen(),
    );
  }
}
