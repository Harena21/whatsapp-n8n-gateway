import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import express from 'express';
import pino from 'pino';
import qrcode from 'qrcode';

const app = express();
app.use(express.json());

const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
let latestQR = null;
let isConnected = false;

async function connectToWhatsApp() {
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            latestQR = qr;
            console.log('QR ready → open /qr in browser');
        }
        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            latestQR = null;
            console.log('WhatsApp connected!');
        }
    });

    app.post('/send', async (req, res) => {
        const { number, message } = req.body;
        try {
            const jid = `${number}@s.whatsapp.net`;
            await sock.sendMessage(jid, { text: message });
            res.status(200).json({ status: 'Success' });
        } catch (error) {
            res.status(500).json({ status: 'Error', error: error.message });
        }
    });
}

app.get('/qr', async (req, res) => {
    if (isConnected) return res.send('<h2>✅ WhatsApp déjà connecté !</h2>');
    if (!latestQR) return res.send('<h2>⏳ QR pas encore prêt, attends 10 secondes et recharge...</h2>');
    const img = await qrcode.toDataURL(latestQR);
    res.send(`<html><body style="text-align:center;font-family:Arial">
        <h2>Scane ce QR avec WhatsApp</h2>
        <img src="${img}" style="width:300px"/>
        <p>Recharge cette page si le QR expire</p>
    </body></html>`);
});

app.get('/status', (req, res) => {
    res.json({ connected: isConnected, qrAvailable: !!latestQR });
});

await connectToWhatsApp();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
