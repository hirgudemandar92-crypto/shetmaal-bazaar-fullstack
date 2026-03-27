# SMS Setup Instructions

## Twilio SMS Integration

To enable SMS notifications for order confirmations, follow these steps:

### 1. Create a Twilio Account
1. Go to https://www.twilio.com/
2. Sign up for a free account
3. Verify your email and phone number

### 2. Get Your Twilio Credentials
1. Go to your Twilio Console Dashboard
2. Note down your:
   - **Account SID** (starts with AC...)
   - **Auth Token** (32-character string)
   - **Phone Number** (Get a trial number or buy one)

### 3. Configure Environment Variables
1. Copy `.env.example` to `.env`
2. Fill in your Twilio credentials:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890
```

### 4. Test SMS (Optional)
- Use Twilio's trial account to send test SMS
- Trial accounts can only send SMS to verified numbers initially

### 5. Production Setup
- Upgrade to a paid Twilio account for production use
- Add more phone numbers as needed
- Monitor usage and costs in Twilio Console

## SMS Message Format
When an order is placed, customers will receive:
```
शेतमाल बाजार: आपली ऑर्डर क्र. [ORDER_ID] यशस्वीपणे नोंदवली गेली आहे. एकूण रक्कम: ₹[TOTAL]. धन्यवाद!
```

## Troubleshooting
- Check console logs for SMS sending status
- Verify phone numbers are in +91XXXXXXXXXX format
- Ensure sufficient Twilio balance for SMS