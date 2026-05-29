/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as spotifySessionExpired } from './spotify-session-expired.tsx'
import { template as curatorOutreach } from './curator-outreach.tsx'
import { template as labelSpreadsheetReminder } from './label-spreadsheet-reminder.tsx'
import { template as campaignAccessOtp } from './campaign-access-otp.tsx'
import { template as campaignCompleted } from './campaign-completed.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'spotify-session-expired': spotifySessionExpired,
  'curator-outreach': curatorOutreach,
  'label-spreadsheet-reminder': labelSpreadsheetReminder,
  'campaign-access-otp': campaignAccessOtp,
  'campaign-completed': campaignCompleted,
}
