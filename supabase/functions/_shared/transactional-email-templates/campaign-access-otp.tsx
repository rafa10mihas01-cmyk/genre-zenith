/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'

interface Props {
  code: string;
  track_name?: string;
  artist?: string;
}

function CampaignAccessOtp({ code, track_name, artist }: Props) {
  return (
    <html>
      <body style={{ margin: 0, padding: 0, background: '#ffffff', fontFamily: 'Inter, Arial, sans-serif', color: '#0a0a0a' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ background: '#ffffff', padding: '40px 16px' }}>
          <tr>
            <td align="center">
              <table width="520" cellPadding={0} cellSpacing={0} style={{ maxWidth: 520, background: '#fafafa', borderRadius: 16, padding: 32 }}>
                <tr><td>
                  <div style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 12 }}>NexEngine · Portal do cliente</div>
                  <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px 0', color: '#0a0a0a' }}>Seu código de acesso</h1>
                  {track_name ? (
                    <p style={{ fontSize: 14, color: '#525252', margin: '0 0 24px 0' }}>
                      Campanha: <strong>{track_name}</strong>{artist ? ` — ${artist}` : ''}
                    </p>
                  ) : null}
                  <div style={{ background: '#ffffff', border: '1px solid #e5e5e5', borderRadius: 12, padding: '20px 24px', textAlign: 'center', margin: '8px 0 24px 0' }}>
                    <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '0.4em', color: '#0a0a0a', fontFamily: 'monospace' }}>{code}</div>
                  </div>
                  <p style={{ fontSize: 13, color: '#737373', lineHeight: 1.5, margin: 0 }}>
                    Use este código para entrar no portal. Ele expira em 10 minutos e só pode ser usado uma vez.
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
  component: CampaignAccessOtp,
  subject: (data) => `Código de acesso: ${data.code}`,
  displayName: 'Código de acesso do portal',
  previewData: { code: '123456', track_name: 'Minha música', artist: 'Artista' },
}
