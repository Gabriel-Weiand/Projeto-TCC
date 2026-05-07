"""
Testes para sincronização de horário UTC.

Valida que:
  1. NTP sync funciona e retorna UTC correto
  2. Offset local é detectado corretamente
  3. Timezone IANA é descoberto
  4. Conversão local→UTC→local roundtrip é consistente
"""

import unittest
from datetime import datetime, timezone, timedelta
import time


class TestTimeSync(unittest.TestCase):

    def test_ntp_sync(self):
        """NTP deve sincronizar com pelo menos um servidor."""
        from time_sync import sync_ntp, is_synced, get_offset
        ok = sync_ntp()
        self.assertTrue(ok, 'NTP deve sincronizar com algum servidor')
        self.assertTrue(is_synced())
        # Offset deve ser pequeno (< 5 segundos) se relógio está razoável
        self.assertLess(abs(get_offset()), 5.0, 'Offset NTP deve ser < 5s')

    def test_utc_now(self):
        """utc_now() deve retornar datetime em UTC."""
        from time_sync import sync_ntp, utc_now
        sync_ntp()
        now = utc_now()
        self.assertEqual(now.tzinfo, timezone.utc, 'Deve ser timezone-aware UTC')
        # Diferença entre sistema UTC e NTP UTC deve ser < 2s
        system_utc = datetime.now(timezone.utc)
        diff = abs((now - system_utc).total_seconds())
        self.assertLess(diff, 2.0, f'Diferença NTP vs sistema: {diff:.3f}s')

    def test_utc_iso(self):
        """utc_iso() deve retornar formato ISO 8601 com Z."""
        from time_sync import sync_ntp, utc_iso
        sync_ntp()
        iso = utc_iso()
        self.assertTrue(iso.endswith('Z'), f'Deve terminar com Z: {iso}')
        self.assertRegex(iso, r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')

    def test_local_offset(self):
        """Deve detectar offset local correto."""
        from time_sync import local_utc_offset_hours
        offset = local_utc_offset_hours()
        # Offset deve ser um número razoável (-12 a +14)
        self.assertGreaterEqual(offset, -12)
        self.assertLessEqual(offset, 14)
        print(f'  Offset local: UTC{offset:+.1f}h')

    def test_local_iana_timezone(self):
        """Deve descobrir timezone IANA do sistema."""
        from time_sync import local_iana_timezone
        tz = local_iana_timezone()
        self.assertIsInstance(tz, str)
        self.assertTrue(len(tz) > 0)
        # Deve conter / (ex: America/Sao_Paulo) ou ser UTC
        self.assertTrue('/' in tz or tz == 'UTC', f'IANA timezone inválido: {tz}')
        print(f'  IANA timezone: {tz}')

    def test_roundtrip_local_utc(self):
        """Conversão local→UTC→local deve preservar o instante."""
        from time_sync import utc_now, local_utc_offset_hours
        sync_from_time_sync = True
        try:
            from time_sync import sync_ntp
            sync_ntp()
        except Exception:
            sync_from_time_sync = False

        utc = utc_now()
        offset_h = local_utc_offset_hours()
        # Converte UTC → local
        local_tz = timezone(timedelta(hours=offset_h))
        local_time = utc.astimezone(local_tz)
        # Converte local → UTC novamente
        back_to_utc = local_time.astimezone(timezone.utc)
        # Devem ser iguais (mesmo instante)
        diff = abs((utc - back_to_utc).total_seconds())
        self.assertLess(diff, 0.001, f'Roundtrip deve preservar instante, diff={diff}s')

    def test_frontend_scenario(self):
        """
        Simula cenário do frontend:
        - Usuário escolhe 14:30 no formulário (horário local Brasil, UTC-3)
        - Browser converte para UTC: 17:30Z
        - Servidor armazena 17:30 UTC
        - Ao exibir, converte de volta para local: 14:30
        """
        # Simula: usuário no Brasil (UTC-3) seleciona 14:30
        local_hour = 14
        local_minute = 30
        local_tz = timezone(timedelta(hours=-3))

        # Frontend: new Date("2026-04-02T14:30:00").toISOString()
        local_dt = datetime(2026, 4, 2, local_hour, local_minute, tzinfo=local_tz)
        utc_iso_str = local_dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')

        # Verifica que o UTC é 17:30
        self.assertEqual(utc_iso_str, '2026-04-02T17:30:00.000Z')

        # Servidor recebe e armazena como UTC
        server_dt = datetime.fromisoformat(utc_iso_str.replace('Z', '+00:00'))
        self.assertEqual(server_dt.hour, 17)
        self.assertEqual(server_dt.minute, 30)

        # Frontend exibe: converte UTC → local
        display_dt = server_dt.astimezone(local_tz)
        self.assertEqual(display_dt.hour, 14, 'Horário exibido deve ser 14:30 local')
        self.assertEqual(display_dt.minute, 30)

        print(f'  Local: {local_hour}:{local_minute:02d} → UTC: {utc_iso_str} → Display: {display_dt.hour}:{display_dt.minute:02d}')


if __name__ == '__main__':
    unittest.main(verbosity=2)
