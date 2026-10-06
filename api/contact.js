import nodemailer from 'nodemailer';
import {
    isAllowedOrigin,
    isCrossSite,
    isJsonContentType,
    validateSubmission,
    createRateLimiter,
    clientIp,
    escapeHtml,
} from './_lib/validation.js';

/* ==========================================================================
   NaiGrowth — Contact endpoint

   Layers, outermost first:
     1. Method must be POST
     2. Sec-Fetch-Site must not be cross-site
     3. Content-Type must be application/json (blocks the simple cross-origin
        form POST, which needs no CORS preflight)
     4. Origin must be an exact naigrowth.com host
     5. Per-IP rate limit
     6. Honeypot + timing trap (answered 200 so bots learn nothing)
     7. Field validation, allow-listed service, spam heuristics
     8. CRLF stripped from every header-bound value before the mail is built

   All request-shaping logic lives in ./_lib/validation.js so it can be unit
   tested without a network. See test/ for the suite.
   ========================================================================== */

const WINDOW_MS = 10 * 60 * 1000;

const limiter = createRateLimiter({ windowMs: WINDOW_MS, max: 3 });

/* A second ceiling with no key, so a spread of addresses cannot do what one
   address is stopped from doing. 3 per IP per ten minutes bounds one sender;
   this bounds the mailbox and the SMTP quota as a whole. Per-instance like
   the other limiter, so it is a cost ceiling rather than an access control,
   and it sits well above any real day's enquiries. */
const burst = createRateLimiter({ windowMs: WINDOW_MS, max: 40, maxKeys: 1 });

/* Previews and local work are opt-in through an env var rather than a broad
   "*.vercel.app" pattern, which let anyone's preview deployment post here. */
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const ALLOW_LOCALHOST = process.env.NODE_ENV !== 'production';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    if (isCrossSite(req.headers['sec-fetch-site'])) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    if (!isJsonContentType(req.headers['content-type'])) {
        return res
            .status(415)
            .json({ success: false, message: 'Unsupported Media Type' });
    }

    const origin = req.headers.origin || '';
    if (
        !isAllowedOrigin(origin, { allowLocalhost: ALLOW_LOCALHOST, extra: EXTRA_ORIGINS })
    ) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const ip = clientIp(req.headers);
    if (limiter.check(ip) || burst.check('all')) {
        // Retry-After keeps a well-behaved client from hammering the window.
        res.setHeader('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
        return res
            .status(429)
            .json({ success: false, message: 'Too many requests. Please try again later.' });
    }

    const result = validateSubmission(req.body || {});

    if (!result.ok) {
        // Silent rejections answer 200 so an automated client cannot tell a
        // blocked submission from a delivered one.
        if (result.silent) {
            return res.status(200).json({ success: true, message: 'Message sent successfully!' });
        }
        return res.status(result.status).json({ success: false, message: result.message });
    }

    const safe = result.value;

    const transporter = nodemailer.createTransport({
        host: 'smtp.zoho.in',
        port: 465,
        secure: true,
        auth: {
            user: process.env.ZOHO_EMAIL,
            pass: process.env.ZOHO_APP_PASSWORD,
        },
    });

    try {
        await transporter.sendMail({
            from: `"NaiGrowth Website" <${process.env.ZOHO_EMAIL}>`,
            to: 'admin@naigrowth.com',
            replyTo: safe.email,
            subject: `New enquiry: ${safe.name}`,
            text: [
                'New enquiry from the NaiGrowth website.',
                '',
                `Name: ${safe.name}`,
                `Email: ${safe.email}`,
                `Phone/WhatsApp: ${safe.phone}`,
                `Service: ${safe.service}`,
                `Sender IP: ${ip}`,
                '',
                'Message:',
                safe.message,
            ].join('\n'),
            html: `
        <h3>New enquiry</h3>
        <p><strong>Name:</strong> ${escapeHtml(safe.name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(safe.email)}</p>
        <p><strong>Phone/WhatsApp:</strong> ${escapeHtml(safe.phone)}</p>
        <p><strong>Service:</strong> ${escapeHtml(safe.service)}</p>
        <p><strong>Sender IP:</strong> ${escapeHtml(ip)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(safe.message).replace(/\n/g, '<br>')}</p>
      `,
        });

        return res.status(200).json({ success: true, message: 'Message sent successfully!' });
    } catch (error) {
        // Message only. A full error dump can carry the SMTP conversation into
        // the log, and logs are not the place for transport detail.
        console.error('contact: mail send failed:', error && error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to send message. Please try WhatsApp or email us directly.',
        });
    }
}
