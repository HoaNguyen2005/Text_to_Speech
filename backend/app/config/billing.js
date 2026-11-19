require('./env');
function getBillingConfig() {
    const bank={bank_code:(process.env.SEPAY_BANK_CODE||'').trim(),gateway:(process.env.SEPAY_BANK_GATEWAY||process.env.SEPAY_BANK_CODE||'').trim(),
        account_number:(process.env.SEPAY_ACCOUNT_NUMBER||'').trim(),account_name:(process.env.SEPAY_ACCOUNT_NAME||'').trim()};
    const secret=process.env.SEPAY_WEBHOOK_SECRET||'';
    return {bank,secret,apiToken:process.env.SEPAY_API_TOKEN||'',demo:process.env.BILLING_DEMO_PRICES==='true',
        configured:process.env.BILLING_ENABLED==='true' && secret.length>=24 && Boolean(bank.bank_code && bank.gateway && bank.account_number && bank.account_name)};
}
module.exports={getBillingConfig};
