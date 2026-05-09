/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'NexEngine'

interface SpotifySessionExpiredProps {
  detectedAt?: string
  lastSuccessfulCollectAt?: string
  panelUrl?: string
  botMessage?: string
}

const SpotifySessionExpiredEmail = ({
  detectedAt,
  lastSuccessfulCollectAt,
  panelUrl = 'https://engine.nexcreatorx.com/sistema',
  botMessage,
}: SpotifySessionExpiredProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Sessão do Spotify expirou — bot parou de coletar</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Sessão do Spotify expirou</Heading>
        <Text style={text}>
          O bot detectou que a sessão do Spotify for Artists não está mais válida
          e parou de coletar dados das campanhas.
        </Text>

        <Section style={infoBox}>
          <Text style={infoLabel}>Horário do problema</Text>
          <Text style={infoValue}>{detectedAt || '—'}</Text>

          <Hr style={divider} />

          <Text style={infoLabel}>Última coleta bem-sucedida</Text>
          <Text style={infoValue}>{lastSuccessfulCollectAt || 'sem registro recente'}</Text>

          {botMessage ? (
            <>
              <Hr style={divider} />
              <Text style={infoLabel}>Mensagem do bot</Text>
              <Text style={infoValue}>{botMessage}</Text>
            </>
          ) : null}
        </Section>

        <Text style={text}>
          <strong>Ação necessária:</strong> renove a sessão do Spotify e reinicie
          o bot para retomar a coleta.
        </Text>

        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={panelUrl} style={button}>
            Abrir painel
          </Button>
        </Section>

        <Text style={footer}>{SITE_NAME} · alerta automático</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SpotifySessionExpiredEmail,
  subject: 'Sessão do Spotify expirou — bot parou de coletar',
  displayName: 'Spotify session expired alert',
  to: 'rafa10mihas01@gmail.com',
  previewData: {
    detectedAt: '2026-05-09 14:32 BRT',
    lastSuccessfulCollectAt: '2026-05-09 13:48 BRT',
    panelUrl: 'https://engine.nexcreatorx.com/sistema',
    botMessage: 'Spotify session invalid — login required',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
}
const container = { padding: '32px 24px', maxWidth: '560px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 600,
  color: '#0f172a',
  margin: '0 0 16px',
}
const text = {
  fontSize: '14px',
  color: '#475569',
  lineHeight: '1.6',
  margin: '0 0 16px',
}
const infoBox = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '16px 20px',
  margin: '20px 0',
}
const infoLabel = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
  color: '#94a3b8',
  margin: '0 0 4px',
}
const infoValue = {
  fontSize: '14px',
  color: '#0f172a',
  fontWeight: 500,
  margin: '0',
}
const divider = {
  borderTop: '1px solid #e2e8f0',
  margin: '14px 0',
}
const button = {
  backgroundColor: '#1DB954',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600,
  padding: '12px 24px',
  borderRadius: '10px',
  textDecoration: 'none',
  display: 'inline-block',
}
const footer = {
  fontSize: '12px',
  color: '#94a3b8',
  margin: '32px 0 0',
  textAlign: 'center' as const,
}
