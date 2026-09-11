import nodemailer, { type Transporter } from 'nodemailer'

import type { Env } from '../config/env.js'

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT')

/**
 * SMTP when configured; otherwise nodemailer's JSON transport, which "sends"
 * by returning the message — what development without a mail server and the
 * test suite want.
 */
export function createMailTransport(env: Env): Transporter {
  return env.SMTP_URL
    ? nodemailer.createTransport(env.SMTP_URL)
    : nodemailer.createTransport({ jsonTransport: true })
}
