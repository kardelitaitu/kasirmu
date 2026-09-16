//! Merchant Category Code (MCC) descriptions.
//!
//! MCC codes follow ISO 18245. This module provides a static lookup table
//! covering codes commonly encountered in Indonesian QRIS deployments.

/// Return a human-readable description for a 4-digit MCC code, or `None` if unknown.
///
/// # Examples
///
/// ```
/// use qris_core::mcc::mcc_description;
///
/// assert_eq!(mcc_description("5812"), Some("Eating Places and Restaurants"));
/// assert_eq!(mcc_description("9999"), None);
/// ```
pub fn mcc_description(mcc: &str) -> Option<&'static str> {
    match mcc {
        // ── Agriculture & Livestock ──────────────────────────────────────
        "0742" => Some("Veterinary Services"),
        "0763" => Some("Agricultural Co-operatives"),
        "0780" => Some("Landscaping and Horticultural Services"),
        // ── Construction ─────────────────────────────────────────────────
        "1520" => Some("General Contractors — Residential Buildings"),
        "1711" => Some("Heating, Plumbing, Air-Conditioning Contractors"),
        "1731" => Some("Electrical Contractors"),
        "1740" => Some("Masonry, Stonework, Tile Setting"),
        "1750" => Some("Carpentry Contractors"),
        "1761" => Some("Roofing, Siding, Sheet Metal Contractors"),
        "1771" => Some("Concrete Work Contractors"),
        "1799" => Some("Special Trade Contractors"),
        // ── Transportation ───────────────────────────────────────────────
        "4111" => Some("Local and Suburban Passenger Transportation"),
        "4112" => Some("Passenger Railways"),
        "4121" => Some("Taxicabs and Ride-hailing"),
        "4131" => Some("Bus Lines"),
        "4214" => Some("Motor Freight Carriers"),
        "4215" => Some("Courier Services"),
        "4411" => Some("Steamship and Cruise Lines"),
        "4511" => Some("Airlines and Air Carriers"),
        "4722" => Some("Travel Agencies and Tour Operators"),
        // ── Telecommunications ───────────────────────────────────────────
        "4812" => Some("Telephone Equipment and Accessories"),
        "4814" => Some("Telecommunication Services"),
        "4816" => Some("Computer Network/Information Services"),
        "4899" => Some("Cable, Satellite, and Pay Television"),
        // ── Utilities ────────────────────────────────────────────────────
        "4900" => Some("Utilities — Electric, Gas, Water"),
        // ── Retail — General ─────────────────────────────────────────────
        "5045" => Some("Computers, Peripherals, and Software"),
        "5065" => Some("Electrical Parts and Equipment"),
        "5072" => Some("Hardware Equipment and Supplies"),
        "5085" => Some("Industrial and Commercial Supplies"),
        "5094" => Some("Jewelry, Watches, and Clocks (Wholesale)"),
        "5099" => Some("Durable Goods, Not Elsewhere Classified"),
        "5122" => Some("Drugs, Drug Proprietaries and Sundries"),
        "5192" => Some("Books, Periodicals, and Newspapers"),
        "5211" => Some("Lumber and Building Materials"),
        "5251" => Some("Hardware Stores"),
        "5261" => Some("Lawn and Garden Supply Stores"),
        "5311" => Some("Department Stores"),
        "5331" => Some("Variety Stores"),
        "5399" => Some("General Merchandise Stores"),
        // ── Retail — Food ────────────────────────────────────────────────
        "5411" => Some("Grocery Stores and Supermarkets"),
        "5441" => Some("Candy, Nut, and Confectionery Stores"),
        "5451" => Some("Dairy Products Stores"),
        "5461" => Some("Bakeries"),
        "5499" => Some("Miscellaneous Food Stores"),
        // ── Retail — Automotive ──────────────────────────────────────────
        "5511" => Some("Car and Truck Dealers"),
        "5521" => Some("Used Car Dealers"),
        "5533" => Some("Auto Parts and Accessories Stores"),
        "5541" => Some("Service Stations / Petrol Stations"),
        "5571" => Some("Motorcycle Shops and Dealers"),
        "5599" => Some("Automotive Parts and Stores, Not Elsewhere Classified"),
        // ── Retail — Clothing ────────────────────────────────────────────
        "5611" => Some("Men's Clothing Stores"),
        "5621" => Some("Women's Clothing Stores"),
        "5631" => Some("Women's Accessory and Specialty Stores"),
        "5641" => Some("Children's and Infants' Clothing Stores"),
        "5651" => Some("Family Clothing Stores"),
        "5661" => Some("Shoe Stores"),
        "5691" => Some("Men's and Women's Clothing Stores"),
        "5699" => Some("Miscellaneous Apparel and Accessory Shops"),
        // ── Retail — Home & Electronics ──────────────────────────────────
        "5712" => Some("Furniture, Home Furnishings, and Equipment Stores"),
        "5722" => Some("Household Appliance Stores"),
        "5732" => Some("Electronics Stores"),
        "5734" => Some("Computer and Computer Software Stores"),
        "5735" => Some("Music Stores — Musical Instruments and Sheet Music"),
        // ── Eating & Drinking ────────────────────────────────────────────
        "5812" => Some("Eating Places and Restaurants"),
        "5813" => Some("Drinking Places (Alcoholic Beverages)"),
        "5814" => Some("Fast Food Restaurants"),
        // ── Health & Pharmacy ────────────────────────────────────────────
        "5912" => Some("Drug Stores and Pharmacies"),
        "5921" => Some("Package Stores — Beer, Wine, and Liquor"),
        // ── Specialty Retail ─────────────────────────────────────────────
        "5941" => Some("Sporting Goods Stores"),
        "5942" => Some("Book Stores"),
        "5943" => Some("Stationery, Office, and School Supply Stores"),
        "5944" => Some("Jewelry Stores, Watches, Clocks"),
        "5945" => Some("Hobby, Toy, and Game Stores"),
        "5947" => Some("Gift, Card, Novelty, and Souvenir Stores"),
        "5948" => Some("Luggage and Leather Goods Stores"),
        "5949" => Some("Sewing, Needlework, and Fabric Stores"),
        "5999" => Some("Miscellaneous and Specialty Retail Stores"),
        // ── Lodging ──────────────────────────────────────────────────────
        "7011" => Some("Hotels, Motels, and Resorts"),
        "7012" => Some("Timeshares"),
        "7021" => Some("Rooming and Boarding Houses"),
        "7041" => Some("Membership Clubs and Organizations"),
        // ── Personal Services ────────────────────────────────────────────
        "7210" => Some("Laundry, Cleaning, and Garment Services"),
        "7211" => Some("Laundry Services — Family and Commercial"),
        "7217" => Some("Carpet and Upholstery Cleaning"),
        "7221" => Some("Photographic Studios"),
        "7231" => Some("Beauty Salons and Barber Shops"),
        "7251" => Some("Shoe Repair and Shoe Shine Shops"),
        "7261" => Some("Funeral Services and Crematories"),
        "7273" => Some("Dating and Escort Services"),
        "7277" => Some("Counseling Services"),
        "7296" => Some("Clothing Rental"),
        "7299" => Some("Personal Services, Not Elsewhere Classified"),
        // ── Business Services ────────────────────────────────────────────
        "7372" => Some("Computer Programming and Data Processing"),
        "7399" => Some("Business Services, Not Elsewhere Classified"),
        // ── Automotive Services ──────────────────────────────────────────
        "7523" => Some("Automobile Parking Lots and Garages"),
        "7542" => Some("Car Washes"),
        "7629" => Some("Electrical and Small Appliance Repair Shops"),
        "7699" => Some("Repair Services, Not Elsewhere Classified"),
        // ── Entertainment ────────────────────────────────────────────────
        "7832" => Some("Motion Picture Theaters"),
        "7922" => Some("Theatrical Ticket Agencies"),
        "7941" => Some("Sports Clubs and Athletic Fields"),
        "7993" => Some("Video Amusement Game Supplies"),
        "7997" => Some("Country Clubs and Membership Sports Facilities"),
        "7999" => Some("Recreation Services, Not Elsewhere Classified"),
        // ── Healthcare ───────────────────────────────────────────────────
        "8011" => Some("Doctors and Physicians"),
        "8021" => Some("Dentists and Orthodontists"),
        "8041" => Some("Chiropractors"),
        "8049" => Some("Podiatrists"),
        "8050" => Some("Nursing and Personal Care Facilities"),
        "8062" => Some("Hospitals"),
        "8099" => Some("Health Practitioners and Medical Services, Not Elsewhere Classified"),
        // ── Professional Services ────────────────────────────────────────
        "8111" => Some("Legal Services and Attorneys"),
        "8911" => Some("Architectural, Engineering, and Surveying Services"),
        "8931" => Some("Accounting, Auditing, and Bookkeeping Services"),
        "8999" => Some("Professional Services, Not Elsewhere Classified"),
        // ── Education ────────────────────────────────────────────────────
        "8211" => Some("Elementary and Secondary Schools"),
        "8220" => Some("Colleges, Universities, Professional Schools"),
        "8241" => Some("Correspondence Schools"),
        "8244" => Some("Business and Secretarial Schools"),
        "8249" => Some("Vocational and Trade Schools"),
        "8299" => Some("Schools and Educational Services, Not Elsewhere Classified"),
        // ── Non-Profit / Religious / Social ──────────────────────────────
        "8641" => Some("Civic, Social, and Fraternal Associations"),
        "8651" => Some("Political Organizations"),
        "8661" => Some("Religious Organizations"),
        "8699" => Some("Membership Organizations, Not Elsewhere Classified"),
        // ── Government ───────────────────────────────────────────────────
        "9211" => Some("Court Costs, Alimony, and Child Support"),
        "9222" => Some("Fines"),
        "9311" => Some("Tax Payments"),
        "9399" => Some("Government Services, Not Elsewhere Classified"),
        "9402" => Some("Postal Services — Government Only"),
        "9405" => Some("Intra-Government Purchases — Government Only"),

        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_codes() {
        assert_eq!(
            mcc_description("5812"),
            Some("Eating Places and Restaurants")
        );
        assert_eq!(mcc_description("5814"), Some("Fast Food Restaurants"));
        assert_eq!(mcc_description("5912"), Some("Drug Stores and Pharmacies"));
        assert_eq!(mcc_description("4121"), Some("Taxicabs and Ride-hailing"));
        assert_eq!(mcc_description("8062"), Some("Hospitals"));
    }

    #[test]
    fn unknown_code_returns_none() {
        assert_eq!(mcc_description("0000"), None);
        assert_eq!(mcc_description("9999"), None);
        assert_eq!(mcc_description(""), None);
    }
}
