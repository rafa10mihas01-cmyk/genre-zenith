/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import type { TemplateEntry } from './registry.ts'

interface Props {
  client_name?: string | null;
  track_name?: string;
  artist?: string | null;
  delivered?: number;
  goal?: number;
}

const fmtN = (n?: number) =>
  typeof n === 'number' && Number.isFinite(n)
    ? n.toLocaleString('pt-BR')
    : '—';

function CampaignCompleted({ client_name, track_name, artist, delivered, goal }: Props) {
  const greeting = client_name ? `Olá ${client_name},` : 'Olá,';
  const trackLine = track_name
    ? `${track_name}${artist ? ` — ${artist}` : ''}`
    : 'sua campanha';
  return (
    <html>
      <body style={{ margin: 0, padding: 0, background: '#ffffff', fontFamily: 'Inter, Arial, sans-serif', color: '#0a0a0a' }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ background: '#ffffff', padding: '40px 16px' }}>
          <tr>
            <td align="center">
              <table width="520" cellPadding={0} cellSpacing={0} style={{ maxWidth: 520, background: '#fafafa', borderRadius: 16, padding: 32 }}>
                <tr><td>
                  <div style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 12 }}>
                    NexEngine · Campanha concluída
                  </div>
                  <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 16px 0', color: '#0a0a0a' }}>
                    Campanha concluída — {fmtN(delivered)} plays entregues
                  </h1>
                  <p style={{ fontSize: 14, color: '#525252', margin: '0 0 24px 0', lineHeight: 1.6 }}>
                    {greeting} a campanha <strong>{trackLine}</strong> atingiu a meta e foi encerrada automaticamente.
                  </p>
                  <div style={{ background: '#ffffff', border: '1px solid #e5e5e5', borderRadius: 12, padding: '20px 24px', margin: '8px 0 24px 0' }}>
                    <table width="100%" cellPadding={0} cellSpacing={0}>
                      <tr>
                        <td style={{ fontSize: 12, color: '#6b7280', paddingBottom: 6 }}>Plays entregues</td>
                        <td style={{ fontSize: 12, color: '#6b7280', paddingBottom: 6, textAlign: 'right' }}>Meta</td>
                      </tr>
                      <tr>
                        <td style={{ fontSize: 22, fontWeight: 700, color: '#1DB954' }}>{fmtN(delivered)}</td>
                        <td style={{ fontSize: 22, fontWeight: 700, color: '#0a0a0a', textAlign: 'right' }}>{fmtN(goal)}</td>
                      </tr>
                    </table>
                  </div>
                  <p style={{ fontSize: 13, color: '#737373', lineHeight: 1.6, margin: 0 }}>
                    Em breve disponibilizaremos o relatório completo com a evolução dia a dia, playlists onde a música tocou e custo por play.
                  </p>
                </td></tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  );
}

export const template = {
  component: CampaignCompleted,
  subject: (data: Record<string, any>) => {
    const delivered = typeof data.delivered === 'number' ? data.delivered.toLocaleString('pt-BR') : '';
    const goal = typeof data.goal === 'number' ? data.goal.toLocaleString('pt-BR') : '';
    return delivered && goal
      ? `Campanha concluída — ${delivered} de ${goal} plays`
      : 'Sua campanha foi concluída';
  },
  displayName: 'Campanha concluída (cliente)',
  previewData: {
    client_name: 'João',
    track_name: 'Nome da Música',
    artist: 'Artista',
    delivered: 9750,
    goal: 10000,
  },
} satisfies TemplateEntry
