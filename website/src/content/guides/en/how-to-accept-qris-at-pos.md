---
title: "How to Accept QRIS Payments at the POS"
description: "Complete guide on accepting QRIS payments at your store register. Static vs dynamic QR, automatic transaction matching, MDR fees, and fraud prevention."
target: "accept qris payments at pos"
commercialParent: "kasir-qris"
pair: "cara-pakai-qris-di-kasir"
updated: "2026-10-25"
order: 6
---

Across Southeast Asian retail environments and international tourist hubs, customer payment preferences have shifted decisively away from physical cash. From coffee shops and boutique stores to neighbourhood bodegas and fast-casual eateries, shoppers expect to complete purchases effortlessly using digital wallets and national QR payment rails.

In Indonesia and interconnected regional payment corridors, the Quick Response Code Indonesian Standard (QRIS) has become the ubiquitous standard. For independent merchants and retail operators, offering seamless QR acceptance at the checkout counter is no longer merely an optional convenience; it is an essential operational requirement.

However, how you deploy QR codes at your cash register directly impacts transaction speed, accounting accuracy, and vulnerability to checkout fraud.

## Static QR vs. Dynamic QR: What Happens at the Checkout Counter?

Many retail merchants assume that displaying any QR code is sufficient. In reality, there are two fundamentally different operational models for QR processing:

### 1. Static QR Codes (Counter Stickers)
A static QR code is a printed paper or acrylic plaque placed near the payment station representing the merchant's fixed National Merchant Identifier (NMID).

- **Customer Workflow:** The shopper scans the printed sticker with their mobile banking app or digital wallet, **manually types the payment amount**, and submits the transfer.
- **Operational Friction:** The cashier must physically inspect the customer's smartphone screen to verify that the store name matches and the typed currency amount is correct. The cashier then manually logs the payment into the register ledger.

### 2. Dynamic QR Codes (POS-Integrated)
With dynamic QR processing, the point-of-sale software generates a fresh, unique QR code for each individual checkout basket. The code appears on the merchant terminal, customer-facing display, or printed receipt bill.

- **Customer Workflow:** The cash register calculates the basket total (for example, $32.50) and embeds that exact sum into the generated QR matrix. The shopper simply scans the code and confirms the payment with their biometric or PIN credentials without typing any numbers.
- **Operational Advantage:** The moment the payment gateway clears the transfer, the POS software receives an automated settlement callback. The cash register logs the sale, deducts inventory, and prints the official receipt automatically without requiring staff to audit personal smartphones.

## The Operational Vulnerabilities of Unintegrated Static QR Stickers

While adhesive static QR stickers are inexpensive to acquire initially, relying on them during peak retail hours exposes store owners to significant operational risks:

1. **Fake Screenshot Fraud:** Dishonest patrons can generate fabricated payment confirmations using mock banking apps or image manipulation tools. In crowded, high-traffic retail environments, rushed cashiers frequently accept a fleeting glimpse of a green confirmation checkmark without verifying actual account deposits.
2. **Keying Errors and Partial Payments:** Because shoppers manually input amounts, typos are common. A customer purchasing $75 in merchandise may inadvertently enter $57 or $7.50. Discrepancies often go unnoticed until end-of-day register balancing.
3. **Checkout Counter Congestion:** Manually verifying each customer's mobile screen, confirming transaction IDs, and awaiting SMS alerts takes 30 to 60 seconds per customer. During busy lunch or dinner peaks, these delays cause severe queue bottlenecks.

## Best Practices for Integrated QR Checkout Workflows

Deploying a professional point-of-sale system transforms QR payment acceptance into a four-step frictionless process:

### Step 1: Ring Up the Basket
The cashier scans item barcodes or selects menu products on the touchscreen register interface.

### Step 2: Select QR Payment Tender
At the tender screen, the operator chooses QRIS / QR Payment. The point-of-sale engine communicates with the configured payment gateway to mint a secure, transaction-specific dynamic QR code.

### Step 3: Customer Scans the Terminal
The dynamic QR code displays instantly on the customer-facing screen or main tablet display. The shopper scans the code using their preferred mobile wallet or banking application.

### Step 4: Automatic Settlement and Ticket Printing
Upon payment authorization, the payment gateway transmits a web hook or polling callback to the local register. The system automatically confirms the tender, updates sales analytics, releases the cash drawer if change is needed, and prints the customer receipt.

## Transparent Processing Fees (MDR)

National QR payment networks are strictly regulated to protect small business profit margins:

- **Micro-Merchants:** Typically enjoy a 0% Merchant Discount Rate (MDR) on transactions under standard statutory limits, with nominal caps (around 0.3%) on higher sums.
- **Small and Medium Enterprises:** Regulated standard processing rates average around 0.7%, far below legacy credit card interchange percentages (1.5% to 3.0%).

For example, processing a $10 sale incurs mere pennies in gateway fees, while completely eliminating cash counting discrepancies, counterfeit bill risks, and manual bank deposit trips.

Merchants should select software that passes through official clearing fees without adding artificial per-transaction software surcharges.

## Flexible QR Acceptance with kasir.mu

Through the [kasir.mu QRIS POS system](/en/kasir-qris/), merchants are never forced into restrictive hardware or single-provider contracts:

- **Integrated Dynamic QR Generation:** Native integration with leading payment gateways allows immediate dynamic QR generation, automatic status polling, and instant receipt printing without requiring leased EDC terminals.
- **Smart Static QR Support:** For retailers who prefer using existing counter stickers, kasir.mu provides dedicated reference tracking and dual-entry reconciliation tools to streamline shift-close auditing.
- **Cross-Platform Accessibility:** Works seamlessly on existing Android tablets, Windows registers, laptops, and touchscreen terminals across all pricing plans, including the Free tier.

## Network Reliability and Offline Contingencies

Store owners frequently ask: *what happens if the store's internet connection drops while a customer is attempting to pay via QR code?*

Because electronic payment verification requires inter-bank network communication, generating and confirming dynamic QR payments relies on active connectivity. However, an engineered local-first POS maintains full operational continuity. 

If connectivity drops, cash transactions and offline queues continue processing without interruption. Pending electronic records are safely preserved until the network reconnects. For an in-depth breakdown of offline data guarantees, review our technical guide on [offline POS apps](/en/guides/offline-pos-app/).

Integrating automated QR acceptance into your store's point-of-sale workflow eliminates payment discrepancies, shields your cash drawer from fraudulent screenshots, and delivers the frictionless digital experience modern shoppers demand.
