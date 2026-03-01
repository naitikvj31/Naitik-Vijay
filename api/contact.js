import nodemailer from 'nodemailer';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { name, email, phone, service, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ message: 'Name, email, and message are required.' });
    }

    // Create reusable transporter object using Zoho SMTP
    // Ensure that ZOHO_EMAIL and ZOHO_APP_PASSWORD are set in your Vercel Environment Variables
    const transporter = nodemailer.createTransport({
        host: 'smtp.zoho.in',
        port: 465,
        secure: true, // use SSL
        auth: {
            user: process.env.ZOHO_EMAIL,
            pass: process.env.ZOHO_APP_PASSWORD,
        },
    });

    try {
        // Send email to the admin
        await transporter.sendMail({
            from: `"NaiGrowth Website" <${process.env.ZOHO_EMAIL}>`, // sender address must match Zoho auth
            to: 'admin@naigrowth.com', // list of receivers
            replyTo: email,
            subject: `New Consultation Request: ${name}`,
            text: `
You have a new consultation request from the NaiGrowth website.

Name: ${name}
Email: ${email}
Phone/WhatsApp: ${phone || 'Not provided'}
Service Interested In: ${service || 'Not specified'}

Message:
${message}
      `,
            html: `
        <h3>New Consultation Request</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone/WhatsApp:</strong> ${phone || 'Not provided'}</p>
        <p><strong>Service Interested In:</strong> ${service || 'Not specified'}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
        });

        res.status(200).json({ success: true, message: 'Message sent successfully!' });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ success: false, message: 'Failed to send message.', error: error.toString() });
    }
}
