import 'package:flutter_test/flutter_test.dart';
import 'package:seb_cbt/src/config_store.dart';

void main() {
  group('normalizeBaseUrl', () {
    test('menambahkan https:// bila skema tidak ada', () {
      expect(ConfigStore.normalizeBaseUrl('cbt.sman1gorontalo.sch.id'), 'https://cbt.sman1gorontalo.sch.id');
    });
    test('mempertahankan path dan menghapus slash di akhir', () {
      expect(ConfigStore.normalizeBaseUrl('http://10.0.2.2:8080/'), 'http://10.0.2.2:8080');
      expect(ConfigStore.normalizeBaseUrl('https://example.com/cbt/'), 'https://example.com/cbt');
    });
    test('LAN (IP privat) tanpa skema di-default ke http://', () {
      expect(ConfigStore.normalizeBaseUrl('192.168.1.10:8080'), 'http://192.168.1.10:8080');
      expect(ConfigStore.normalizeBaseUrl('192.168.1.10/'), 'http://192.168.1.10');
      expect(ConfigStore.normalizeBaseUrl('10.1.2.3'), 'http://10.1.2.3');
      expect(ConfigStore.normalizeBaseUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
      expect(ConfigStore.normalizeBaseUrl('172.16.5.5:3000'), 'http://172.16.5.5:3000');
      expect(ConfigStore.normalizeBaseUrl('172.31.0.1'), 'http://172.31.0.1');
      expect(ConfigStore.normalizeBaseUrl('localhost:8080'), 'http://localhost:8080');
    });
    test('host publik/domain tanpa skema di-default ke https://', () {
      expect(ConfigStore.normalizeBaseUrl('cbt.sman1gorontalo.sch.id'), 'https://cbt.sman1gorontalo.sch.id');
      expect(ConfigStore.normalizeBaseUrl('172.32.0.1'), 'https://172.32.0.1');
      expect(ConfigStore.normalizeBaseUrl('8.8.8.8'), 'https://8.8.8.8');
      expect(ConfigStore.normalizeBaseUrl('notaurl'), 'https://notaurl');
    });
    test('menolak URL tanpa host', () {
      expect(ConfigStore.normalizeBaseUrl('https://'), isNull);
      expect(ConfigStore.normalizeBaseUrl(''), isNull);
      // Hostname polos dianggap valid (di-upgrade ke https).
      expect(ConfigStore.normalizeBaseUrl('notaurl'), 'https://notaurl');
    });
  });

  group('fingerprint', () {
    test('menghasilkan 8 hex deterministik dan tidak memuat key', () {
      const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      final fp = ConfigStore.fingerprint(key);
      expect(fp, isNotNull);
      expect(fp, hasLength(8));
      expect(fp, matches(RegExp(r'^[a-f0-9]{8}$')));
      expect(fp, equals(ConfigStore.fingerprint(key)));
      expect(key.contains(fp!), isFalse);
    });
    test('key kosong → null', () {
      expect(ConfigStore.fingerprint(''), isNull);
      expect(ConfigStore.fingerprint(null), isNull);
    });
  });

  group('originOf', () {
    test('membangun origin dari base URL', () {
      expect(ConfigStore.originOf('http://10.0.2.2:8080').toString(), 'http://10.0.2.2:8080');
      expect(ConfigStore.originOf('https://cbt.sman1gorontalo.sch.id/app/').toString(), 'https://cbt.sman1gorontalo.sch.id');
    });
  });
}
