// server.js - Waste-to-Wealth Payment Backend
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors()); // Allows your frontend to communicate with this backend
app.use(express.json()); // Parses incoming JSON requests
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// Safaricom Credentials (loaded securely from .env file)
const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;
const PASSKEY = process.env.PASSKEY;
const SHORTCODE = process.env.SHORTCODE; // Usually 174379 for Sandbox
const CALLBACK_URL = process.env.CALLBACK_URL; // Where Safaricom sends the receipt

// ----------------------------------------------------
// 1. MIDDLEWARE: Generate M-Pesa Access Token
// ----------------------------------------------------
const generateToken = async (req, res, next) => {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    
    try {
        const response = await axios.get(
            'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            {
                headers: {
                    Authorization: `Basic ${auth}`
                }
            }
        );
        req.token = response.data.access_token;
        next();
    } catch (error) {
        console.error('Token Generation Error:', error.message);
        res.status(400).json({ error: 'Failed to generate Safaricom access token' });
    }
};

// ----------------------------------------------------
// 2. ROUTE: Trigger STK Push (Prompts user for PIN)
// ----------------------------------------------------
app.post('/api/pay', generateToken, async (req, res) => {
    const { phone, amount, accountReference, transactionDesc } = req.body;

    // Format phone number to require 254 format (e.g., 254712345678)
    let formattedPhone = phone;
    if (phone.startsWith('0')) {
        formattedPhone = `254${phone.substring(1)}`;
    } else if (phone.startsWith('+')) {
        formattedPhone = phone.substring(1);
    }

    // Generate Timestamp (YYYYMMDDHHmmss)
    const date = new Date();
    const timestamp = date.getFullYear() +
        ("0" + (date.getMonth() + 1)).slice(-2) +
        ("0" + date.getDate()).slice(-2) +
        ("0" + date.getHours()).slice(-2) +
        ("0" + date.getMinutes()).slice(-2) +
        ("0" + date.getSeconds()).slice(-2);

    // Generate Password
    const password = Buffer.from(SHORTCODE + PASSKEY + timestamp).toString('base64');

    try {
        const response = await axios.post(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            {
                BusinessShortCode: SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                TransactionType: 'CustomerPayBillOnline',
                Amount: Math.ceil(amount), // Amount must be an integer
                PartyA: formattedPhone,
                PartyB: SHORTCODE,
                PhoneNumber: formattedPhone,
                CallBackURL: CALLBACK_URL,
                AccountReference: accountReference || 'Waste2Wealth',
                TransactionDesc: transactionDesc || 'Platform Payment'
            },
            {
                headers: {
                    Authorization: `Bearer ${req.token}`
                }
            }
        );

        // Respond to the frontend saying the prompt was sent
        res.status(200).json(response.data);
    } catch (error) {
        console.error('STK Push Error:', error.response ? error.response.data : error.message);
        res.status(400).json({ error: 'STK Push failed' });
    }
});

// ----------------------------------------------------
// 3. ROUTE: M-Pesa Callback Webhook (Receives receipt)
// ----------------------------------------------------
app.post('/api/callback', (req, res) => {
    console.log('--- M-PESA CALLBACK RECEIVED ---');
    
    const callbackData = req.body.Body.stkCallback;
    
    if (callbackData.ResultCode === 0) {
        // PIN entered correctly & sufficient funds
        console.log('✅ Payment Successful!');
        const metadata = callbackData.CallbackMetadata.Item;
        
        const amountPaid = metadata.find(item => item.Name === 'Amount').Value;
        const receiptNumber = metadata.find(item => item.Name === 'MpesaReceiptNumber').Value;
        const phoneNumber = metadata.find(item => item.Name === 'PhoneNumber').Value;

        console.log(`Amount: Ksh ${amountPaid}`);
        console.log(`Receipt: ${receiptNumber}`);
        console.log(`Phone: ${phoneNumber}`);
        
        // TODO (Later): Update the Database here to mark the order/pickup as "Paid"
        
    } else {
        // Transaction failed, cancelled, or timed out
        console.log('❌ Payment Failed or Cancelled.');
        console.log(`Reason: ${callbackData.ResultDesc}`);
    }

    // Always respond to Safaricom to acknowledge receipt of the message
    res.json({
        "ResultCode": 0,
        "ResultDesc": "Success"
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Waste-to-Wealth Payment API is running.');
});

// Start Server
app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});