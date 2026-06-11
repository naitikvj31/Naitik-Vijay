import nodemailer from 'nodemailer';

/* ============================================
   NaiGrowth — Secure Contact Endpoint
   Defenses: honeypot, time-trap, rate limiting,
   strict validation, HTML escaping, spam heuristics
   ============================================ */

const MAX_LEN = { name: 100, email: 254, phone: 30, service: 40, message: 3000 };
const ALLOWED_SERVICES = ['reviews', 'ai', 'salesforce', 'web', 'seo'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Obvious spam-bot signatures (kept conservative so real leads never get blocked)
const SPAM_PATTERNS = [
    /\[url=/i,              // BBCode links
    /<a\s+href/i,           // HTML links pasted into message
    /viagra|cialis|casino|xxx|porn/i,
    /\bcrypto\s*(wallet|invest|profit)/i,
];
const MAX_LINKS_IN_MESSAGE = 2;

// Per-IP rate limit (in-memory; resets on cold start — first line of defense)
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 3 };
const ipHits = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const hits = (ipHits.get(ip) || []).filter(t => now - t < RATE_LIMIT.windowMs);
    if (hits.length >= RATE_LIMIT.max) {
        ipHits.set(ip, hits);
        return true;
    }
    hits.push(now);
    ipHits.set(ip, hits);
    // Prevent unbounded memory growth
    if (ipHits.size > 5000) {
        for (const [key, times] of ipHits) {
            if (times.every(t => now - t >= RATE_LIMIT.windowMs)) ipHits.delete(key);
        }
    }
    return false;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Strip newlines so user input can never inject extra email headers
function singleLine(str) {
    return String(str).replace(/[\r\n]+/g, ' ').trim();
}

function looksLikeSpam(message) {
    if (SPAM_PATTERNS.some(re => re.test(message))) return true;
    const links = (message.match(/https?:\/\//gi) || []).length;
    return links > MAX_LINKS_IN_MESSAGE;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    // Block clearly foreign origins (browsers always send Origin on fetch POSTs)
    const origin = req.headers.origin || '';
    if (origin && !/naigrowth\.com$|\.vercel\.app$|^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (isRateLimited(ip)) {
        return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
    }

    const body = req.body || {};
    const { name, email, phone, service, message } = body;

    // Honeypot: hidden field humans never see — bots fill it.
    // Time-trap: hidden timestamp set by JS — bots posting directly miss it
    // or submit faster than any human could type.
    // Both return a fake success so bots don't learn and adapt.
    const honeypot = body.company_website;
    const formTime = parseInt(body.fts, 10);
    const elapsed = Date.now() - formTime;
    if (honeypot || !formTime || elapsed < 2000) {
        return res.status(200).json({ success: true, message: 'Message sent successfully!' });
    }

    // Validation
    if (!name || !email || !message) {
        return res.status(400).json({ success: false, message: 'Name, email, and message are required.' });
    }
    for (const [field, max] of Object.entries(MAX_LEN)) {
        if (body[field] && String(body[field]).length > max) {
            return res.status(400).json({ success: false, message: `${field} is too long.` });
        }
    }
    if (!EMAIL_RE.test(String(email))) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }
    if (service && !ALLOWED_SERVICES.includes(service)) {
        return res.status(400).json({ success: false, message: 'Invalid service selected.' });
    }
    if (looksLikeSpam(String(message))) {
        return res.status(200).json({ success: true, message: 'Message sent successfully!' });
    }

    const safe = {
        name: singleLine(name),
        email: singleLine(email),
        phone: phone ? singleLine(phone) : 'Not provided',
        service: service || 'Not specified',
        message: String(message).trim(),
    };

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
            subject: `New Consultation Request: ${safe.name}`,
            text: `
You have a new consultation request from the NaiGrowth website.

Name: ${safe.name}
Email: ${safe.email}
Phone/WhatsApp: ${safe.phone}
Service Interested In: ${safe.service}
Sender IP: ${ip}

Message:
${safe.message}
      `,
            html: `
        <h3>New Consultation Request</h3>
        <p><strong>Name:</strong> ${escapeHtml(safe.name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(safe.email)}</p>
        <p><strong>Phone/WhatsApp:</strong> ${escapeHtml(safe.phone)}</p>
        <p><strong>Service Interested In:</strong> ${escapeHtml(safe.service)}</p>
        <p><strong>Sender IP:</strong> ${escapeHtml(ip)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(safe.message).replace(/\n/g, '<br>')}</p>
      `,
        });

        res.status(200).json({ success: true, message: 'Message sent successfully!' });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ success: false, message: 'Failed to send message. Please try WhatsApp or email us directly.' });
    }
}
