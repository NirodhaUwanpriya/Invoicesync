// qbo.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKEN_FILE = path.join(__dirname, 'tokens.json');

// Helper to encode Client ID and Secret for QBO OAuth Header
const getAuthHeader = () => {
    const authString = `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`;
    return Buffer.from(authString).toString('base64');
};

// Helper to get base URL based on environment
const getBaseUrl = () => {
    const prefix = process.env.QBO_ENVIRONMENT === 'sandbox' ? 'sandbox-quickbooks' : 'quickbooks';
    return `https://${prefix}.api.intuit.com/v3/company/${process.env.QBO_COMPANY_ID}`;
};

// 1. TOKEN REFRESH HANDLER
async function getAccessToken() {
    if (!fs.existsSync(TOKEN_FILE)) {
        throw new Error("tokens.json not found! Please run the /auth flow first.");
    }

    const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE));

    if (!tokens.refresh_token) {
        throw new Error("No refresh_token found in tokens.json.");
    }

    try {
        const response = await axios.post(
            'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
            `grant_type=refresh_token&refresh_token=${tokens.refresh_token}`,
            {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${getAuthHeader()}`
                }
            }
        );

        // Save rotated tokens back to file
        fs.writeFileSync(TOKEN_FILE, JSON.stringify({
            access_token: response.data.access_token,
            refresh_token: response.data.refresh_token
        }, null, 2));

        return response.data.access_token;
    } catch (error) {
        console.error("Failed to refresh QBO token:", error.response?.data || error.message);
        throw new Error("QBO Auth Refresh Failed");
    }
}

// 2. FIND OR CREATE CUSTOMER
async function findOrCreateCustomer(customerData) {
    const token = await getAccessToken();
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };

    // Check if customer exists by email
    const query = `select * from Customer where PrimaryEmailAddr = '${customerData.email}'`;
    const searchRes = await axios.get(`${getBaseUrl()}/query?query=${encodeURIComponent(query)}`, { headers });
    
    if (searchRes.data.QueryResponse.Customer && searchRes.data.QueryResponse.Customer.length > 0) {
        console.log(`Customer found in QBO: ${customerData.email}`);
        return searchRes.data.QueryResponse.Customer[0].Id;
    }

    // Create new customer if not found
    console.log(`Customer not found in QBO. Creating record for: ${customerData.email}`);
    const newCustomer = {
        DisplayName: `${customerData.firstName} ${customerData.lastName} - ${customerData.company}`,
        GivenName: customerData.firstName,
        FamilyName: customerData.lastName,
        PrimaryEmailAddr: { Address: customerData.email },
        CompanyName: customerData.company
    };

    const createRes = await axios.post(`${getBaseUrl()}/customer`, newCustomer, { headers });
    return createRes.data.Customer.Id;
}

// 3. CREATE INVOICE
async function createInvoice(customerId, amount) {
    const token = await getAccessToken();
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };

    const invoiceData = {
        CustomerRef: { value: customerId },
        Line: [
            {
                Amount: amount,
                DetailType: "SalesItemLineDetail",
                SalesItemLineDetail: {
                    ItemRef: { value: "1", name: "Services" } // Item "1" is standard for Sandbox
                }
            }
        ]
    };

    const response = await axios.post(`${getBaseUrl()}/invoice`, invoiceData, { headers });
    console.log(`Invoice successfully created! QBO Invoice ID: ${response.data.Invoice.Id}`);
    return response.data.Invoice;
}

module.exports = { findOrCreateCustomer, createInvoice };