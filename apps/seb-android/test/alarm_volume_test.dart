import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:seb_cbt/src/screens/kiosk_screen.dart';

void main() {
  test('polyfill bridge menyediakan maximizeVolume', () {
    expect(kBridgePolyfill, contains('maximizeVolume'));
    expect(kBridgePolyfill, contains("type: 'maximizeVolume'"));
  });

  test('nama channel native sama di Dart dan Kotlin', () {
    final dart = File('lib/src/screens/kiosk_screen.dart').readAsStringSync();
    final kotlin = File(
      'android/app/src/main/kotlin/id/sch/sman1gorontalo/seb/MainActivity.kt',
    ).readAsStringSync();
    expect(dart, contains("MethodChannel('id.sch.sman1gorontalo.seb/kiosk')"));
    expect(kotlin, contains('"maximizeAlarmVolume"'));
    final start = kotlin.indexOf('"maximizeAlarmVolume"');
    final end = kotlin.indexOf('"suppressAlarm"');
    expect(end, greaterThan(start));
    expect(kotlin.substring(start, end), contains('STREAM_ALARM'));
    expect(kotlin, contains('USAGE_ALARM'));
  });
}
