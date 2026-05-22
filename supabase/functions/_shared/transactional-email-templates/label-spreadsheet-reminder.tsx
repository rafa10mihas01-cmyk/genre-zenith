/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'NexEngine'

interface LabelSpreadsheetReminderProps {
  songName?: string
  songArtist?: string
  daysSinceLastUpload?: number
  portalUrl?: string
}

const LabelSpreadsheetReminderEmail = ({
  songName,
  songArtist,
  daysSinceLastUpload,
  portalUrl,
}: LabelSpreadsheetReminderProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Atualize os dados da sua campanha</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Atualize os dados da campanha</Heading>
        <Text style={text}>
          A campanha de <strong>{songName ?? 'sua música'}</strong>
          {songArtist ? ` (${songArtist})` : ''} está
          {daysSinceLastUpload && daysSinceLastUpload > 0
            ? ` há ${daysSinceLastUpload} dias sem nova atualização de dados.`
            : ' sem atualização de dados recente.'}
        </Text>
        <Text style={text}>
          Como essa campanha não tem acesso direto ao Spotify for Artists, você
          precisa subir a planilha mais recente fornecida pela gravadora pra
          gente continuar calculando performance, velocidade e meta.
        </Text>

        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={portalUrl ?? 'https://engine.nexcreatorx.com'} style={button}>
            Subir planilha agora
          </Button>
        </Section>

        <Text style={footerText}>
          É só arrastar o arquivo .xlsx no portal — a gente cuida do resto.
        </Text>

        <Text style={footer}>{SITE_NAME} · lembrete automático</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: LabelSpreadsheetReminderEmail,
  subject: 'Atualize os dados da sua campanha',
  displayName: 'Lembrete: subir planilha da gravadora',
  previewData: {
    songName: 'Carnívoro',
    songArtist: 'Artista Exemplo',
    daysSinceLastUpload: 3,
    portalUrl: 'https://engine.nexcreatorx.com/campanha/exemplo',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
}
const container = { padding: '32px 24px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 600, color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0 0 16px' }
const footerText = {
  fontSize: '13px',
  color: '#64748b',
  textAlign: 'center' as const,
  margin: '0 0 8px',
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
