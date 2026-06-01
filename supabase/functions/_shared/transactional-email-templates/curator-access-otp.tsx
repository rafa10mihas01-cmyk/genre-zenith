/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'

interface Props {
  code: string;
  curator_name?: string;
  song_name?: string;
  song_artist?: string;
}

function CuratorAccessOtp({ code, curator_name, song_name, song_artist }: Props) {
  return (
    <html>
      <body style={{ margin: 0, padding: 0, background: '#ffffff', fontFamily: 'Inter, Arial, sans-serif', color: '#0a0a0a' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ background: '#ffffff', padding: '40px 16px' }}>
          <tr>
            <td align="center">
              <table width="520" cellPadding={0} cellSpacing={0} style={{ maxWidth: 520, background: '#fafafa', borderRadius: 16, padding: 32 }}>
                <tr><td>
                  <div style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 12 }}>NexEngine · Portal do curador</div>
                  <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px 0', color: '#0a0a0a' }}>
                    {curator_name ? `Olá, ${curator_name}` : 'Seu código de acesso'}
                  </h1>
                  {song_name ? (
                    <p style={{ fontSize: 14, color: '#525252', margin: '0 0 24px 0' }}>
                      Acesso ao deal: <strong>{song_name}</strong>{song_artist ? ` — ${song_artist}` : ''}
                    </p>
                  ) : null}
                  <div style={{ background: '#ffffff', border: '1px solid #e5e5e5', borderRadius: 12, padding: '20px 24px', textAlign: 'center', margin: '8px 0 24px 0' }}>
                    <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '0.4em', color: '#0a0a0a', fontFamily: 'monospace' }}>{code}</div>
                  </div>
                  <p style={{ fontSize: 13, color: '#737373', lineHeight: 1.5, margin: 0 }}>
                    Use este código pra entrar no seu painel. Expira em 10 minutos e só pode ser usado uma vez.
                    Se você não pediu este acesso, ignore este e-mail.
                  </p>
                </td></tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  )
}

export const template: TemplateEntry = {
  component: CuratorAccessOtp,
  subject: (data) => `Código de acesso: ${data.code}`,
  displayName: 'Código de acesso do curador',
  previewData: { code: '123456', curator_name: 'Manolo', song_name: 'Minha música', song_artist: 'Artista' },
}
