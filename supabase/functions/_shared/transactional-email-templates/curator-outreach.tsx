/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Img, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'NexEngine'
const LOGO_URL = 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/storage/v1/object/public/email-assets/nexengine-logo.png'
const WHATSAPP_NUMBER = '5511930910013'
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Olá! Vim pelo email da NexEngine.')}`

interface CuratorOutreachProps {
  curator_name?: string
  playlist_name?: string
  message?: string
  signature_name?: string
  signature_role?: string
}

const CuratorOutreachEmail = ({
  curator_name,
  playlist_name,
  message,
  signature_name = 'Equipe NexEngine',
  signature_role = 'Parcerias & Curadoria',
}: CuratorOutreachProps) => {
  const greeting = curator_name
    ? `Olá, ${curator_name}.`
    : 'Olá.'

  // Default copy — premium, executivo, musical. Sem cara de spam.
  const defaultMessage = `Sou da ${SITE_NAME}, plataforma que conecta artistas, gravadoras e curadores em campanhas de distribuição estratégica de catálogo.

Conhecemos seu trabalho${playlist_name ? ` com a playlist "${playlist_name}"` : ''} e gostaríamos de entender como você opera curadoria: como recebe novas faixas, critérios de seleção, e se trabalha com parcerias estruturadas para inclusão de catálogo.

Trabalhamos com lançamentos contínuos em diversos gêneros e selecionamos curadores com perfil editorial sólido para colaborações de médio e longo prazo.

Caso faça sentido, podemos agendar uma conversa de 15 minutos.`

  const body = message?.trim() || defaultMessage

  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>Parceria de curadoria — {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Brand bar */}
          <Section style={brandBar}>
            <Img
              src={LOGO_URL}
              alt={SITE_NAME}
              width="280"
              height="99"
              style={logoImg}
            />
          </Section>

          {/* Card */}
          <Section style={card}>
            <Heading style={h1}>{greeting}</Heading>

            {body.split('\n\n').map((para, i) => (
              <Text key={i} style={text}>{para}</Text>
            ))}

            <Section style={{ textAlign: 'center', margin: '8px 0 4px' }}>
              <Button href={WHATSAPP_URL} style={whatsappBtn}>
                Falar no WhatsApp
              </Button>
            </Section>

            <Hr style={divider} />

            <Text style={signature}>{signature_name}</Text>
            <Text style={signatureRole}>{signature_role} · {SITE_NAME}</Text>
          </Section>

          <Text style={footer}>
            {SITE_NAME} · engine.nexcreatorx.com
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: CuratorOutreachEmail,
  subject: (data: Record<string, any>) =>
    data?.playlist_name
      ? `Parceria de curadoria — ${data.playlist_name}`
      : 'Parceria de curadoria — NexEngine',
  displayName: 'Curator outreach (NexEngine)',
  previewData: {
    curator_name: 'João',
    playlist_name: 'Sertanejo Top',
    signature_name: 'Rafael Mihas',
    signature_role: 'Head of Partnerships',
  },
} satisfies TemplateEntry

/* ---------- styles ---------- */
const main = {
  backgroundColor: '#0a0a0a',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  padding: '40px 16px',
}
const container = { maxWidth: '560px', margin: '0 auto' }

const brandBar = {
  textAlign: 'center' as const,
  padding: '12px 0 32px',
}
const logoImg = {
  display: 'block',
  margin: '0 auto',
  height: '64px',
  width: 'auto',
  maxWidth: '280px',
}
const brandText = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#ffffff',
  letterSpacing: '-0.01em',
  margin: 0,
}
const brandSub = {
  fontSize: '11px',
  color: '#9ca3af',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.16em',
  margin: '4px 0 0',
}

const card = {
  backgroundColor: '#141414',
  border: '1px solid #262626',
  borderRadius: '16px',
  padding: '36px 32px',
}
const h1 = {
  fontSize: '20px',
  fontWeight: 600,
  color: '#ffffff',
  margin: '0 0 20px',
  letterSpacing: '-0.01em',
}
const text = {
  fontSize: '14.5px',
  color: '#d4d4d8',
  lineHeight: '1.65',
  margin: '0 0 16px',
}
const divider = {
  borderTop: '1px solid #262626',
  margin: '28px 0 20px',
}
const signature = {
  fontSize: '14px',
  color: '#ffffff',
  fontWeight: 600,
  margin: '0 0 2px',
}
const signatureRole = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: 0,
}
const footer = {
  fontSize: '11px',
  color: '#6b7280',
  margin: '24px 0 0',
  textAlign: 'center' as const,
  letterSpacing: '0.04em',
}
