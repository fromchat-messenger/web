# Compliance Message Decryption Guide

This guide explains how to decrypt encrypted messages for compliance and legal purposes using the secure offline compliance system.

## Overview

The application uses client-server encryption for direct messages (DMs). While regular users can only decrypt their own messages, compliance officers can decrypt any message for legal compliance purposes using a secure offline process.

## Security Model

- **Regular Users**: Can only decrypt messages encrypted with their own public keys
- **Compliance Officers**: Can decrypt any message using the compliance private key (stored offline)
- **No Server Access**: Compliance private keys are never stored on production servers
- **Audit Trail**: All compliance access is logged with timestamps and user IDs

## Prerequisites

### 1. Compliance Officer Access

- Must be logged in as user ID 1 (system administrator)
- Requires valid JWT authentication token

### 2. Air-Gapped Machine

- A secure, offline computer for decryption
- Compliance private key stored securely
- Python environment with required dependencies

### 3. Files Required

- `compliance_keypair.txt` - Contains compliance X25519 keypair
- `scripts/compliance/decryption/main.py` — decryption tool entrypoint
- Message data extracted from the server

## Step-by-Step Instructions

### Step 1: Extract Message Data from Server

**On the production server (as compliance officer):**

1. Log in to the application as user ID 1
2. Get your JWT token from browser developer tools:
  - Open DevTools (F12)
  - Go to Application → Local Storage
  - Copy the `token` value
3. Extract message data using the API:
  ```bash
   curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
        http://localhost:8300/api/dm/compliance/extract/MESSAGE_ID \
        > compliance_MESSAGE_ID.json
  ```
   Replace `MESSAGE_ID` with the actual message ID you want to decrypt.
4. Verify the extraction was successful:
  ```bash
   cat compliance_MESSAGE_ID.json | jq .
  ```
   Expected response:

### Step 2: Transfer Data to Air-Gapped Machine

**Securely transfer the JSON file to your air-gapped machine:**

- Use encrypted USB drive
- Use secure file transfer protocol
- Never transfer over network if air-gapping is required

### Step 3: Decrypt Message on Air-Gapped Machine

**On the air-gapped machine:**

1. Ensure you have the required files:
  - `compliance_keypair.txt` (compliance private key)
  - `scripts/compliance/decryption/main.py` (decryption tool)
  - `compliance_MESSAGE_ID.json` (extracted message data)
2. Run the decryption:
  ```bash
   python scripts/compliance/decryption/main.py decrypt --input-file compliance_MESSAGE_ID.json
  ```
3. The script will output the decrypted message:
  ```
   🔓 Loading compliance data from: compliance_MESSAGE_ID.json
   📄 Loaded message ID: 123
   📅 Timestamp: 2026-01-10T19:23:37.938054
   👤 Sender: 456, Recipient: 789
   🔐 Has compliance MEK: ✅
   🔑 Loading compliance private key...
   🔓 Decrypting message content...

   ✅ DECRYPTION SUCCESSFUL
   ==================================================
   Message ID: 123
   From: User 456
   To: User 789
   Timestamp: 2026-01-10T19:23:37.938054
   Decrypted at: 2026-01-10T19:33:20.782656
   --------------------------------------------------
   MESSAGE CONTENT:
   {"type":"text","data":{"content":"Your encrypted message here"}}
   --------------------------------------------------
   ⚠️  This content has been accessed for compliance purposes
  ```

## Message Format

Decrypted messages contain the original message payload in JSON format:

```json
{
  "type": "text",
  "data": {
    "content": "The actual message text",
    "files": [...]  // Optional file attachments
  }
}
```

## Security Considerations

### Key Management

- **Compliance private key**: Never stored on production servers
- **Access control**: Only user ID 1 can extract messages
- **Audit logging**: All extractions are logged with timestamps

### Data Handling

- **Secure transfer**: Use encrypted channels for data transfer
- **Immediate destruction**: Delete decrypted content after review
- **No caching**: Don't store decrypted messages

### Operational Security

- **Air-gapped environment**: Use dedicated offline machine for decryption
- **Access controls**: Limit physical access to compliance officers
- **Regular audits**: Review access logs regularly

## Troubleshooting

### "Access denied" Error

- Ensure you're logged in as user ID 1
- Check that your JWT token is valid and not expired

### "Message not found" Error

- Verify the message ID exists
- Check that the message hasn't been deleted

### Decryption Failures

- Ensure `compliance_keypair.txt` is present and contains valid keys
- Check that the JSON file wasn't corrupted during transfer
- Verify Python environment has required cryptography dependencies

### Network Errors

- Ensure the server is running and accessible
- Check firewall and network connectivity
- Verify API endpoints are correctly configured

## API Reference

### Compliance Extraction Endpoint

```
GET /api/dm/compliance/extract/{message_id}
Authorization: Bearer <jwt_token>
Response: JSON with encrypted message data
```

**Restrictions:**

- Requires user ID 1 authentication
- Returns encrypted data only (no plaintext)
- Logs all access for audit purposes

### Decryption Script

```bash
python scripts/compliance/decryption/main.py decrypt --input-file <json_file>
```

**Requirements:**

- `compliance_keypair.txt` in current directory
- Valid JSON file from extraction API
- Python with cryptography library

## Compliance Workflow Summary

```
1. Legal Request → 2. Compliance Officer → 3. Server Extraction → 4. Secure Transfer → 5. Offline Decryption → 6. Content Review → 7. Audit Logging
     ↓                      ↓                         ↓                      ↓                      ↓                      ↓                      ↓
  Legal basis          User ID 1 login           API call with token    Encrypted transfer    Air-gapped machine   Content analysis      Access recorded
```

This ensures complete separation between production systems and compliance decryption, maintaining security while enabling legal access to encrypted communications