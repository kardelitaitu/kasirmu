//! QR code image rendering — converts a QRIS payload string into a QR image.
//!
//! Enabled by the `render` feature flag.

use crate::error::QrisError;

/// Render `payload_str` as a QR code and return PNG bytes.
///
/// The QR code uses error-correction level **M** (15% recovery capacity),
/// which is appropriate for most QRIS display use-cases.
///
/// # Arguments
/// * `pixel_size` — the maximum width/height of the output image in pixels.
pub fn to_png(payload_str: &str, pixel_size: u32) -> Result<Vec<u8>, QrisError> {
    use image::ImageFormat;
    use qrcode::{EcLevel, QrCode};

    let code = QrCode::with_error_correction_level(payload_str.as_bytes(), EcLevel::M)
        .map_err(|e| QrisError::RenderError(e.to_string()))?;

    let img = code
        .render::<image::Luma<u8>>()
        .max_dimensions(pixel_size, pixel_size)
        .build();

    let dynamic = image::DynamicImage::ImageLuma8(img);
    let mut buf = Vec::new();
    dynamic
        .write_to(&mut std::io::Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| QrisError::RenderError(e.to_string()))?;
    Ok(buf)
}

/// Render `payload_str` as a QR code and return an SVG string.
///
/// Uses error-correction level **M**. The SVG has no fixed width/height —
/// use CSS to size it responsively.
pub fn to_svg(payload_str: &str) -> Result<String, QrisError> {
    use qrcode::{EcLevel, QrCode, render::svg};

    let code = QrCode::with_error_correction_level(payload_str.as_bytes(), EcLevel::M)
        .map_err(|e| QrisError::RenderError(e.to_string()))?;

    let svg_string = code
        .render::<svg::Color<'_>>()
        .min_dimensions(200, 200)
        .build();

    Ok(svg_string)
}

/// Render `payload_str` as a QR code with a logo overlaid in the centre.
///
/// Uses error-correction level **H** (30% recovery capacity) so the logo can
/// safely cover up to ~25% of the QR surface area without breaking scannability.
///
/// # Arguments
/// * `pixel_size`  — maximum output image size in pixels
/// * `logo_bytes`  — raw bytes of the logo image (PNG, JPEG, etc.)
pub fn to_png_with_logo(
    payload_str: &str,
    pixel_size: u32,
    logo_bytes: &[u8],
) -> Result<Vec<u8>, QrisError> {
    use image::{DynamicImage, ImageFormat, imageops};
    use qrcode::{EcLevel, QrCode};

    let code = QrCode::with_error_correction_level(payload_str.as_bytes(), EcLevel::H)
        .map_err(|e| QrisError::RenderError(e.to_string()))?;

    let qr_img = code
        .render::<image::Rgba<u8>>()
        .max_dimensions(pixel_size, pixel_size)
        .build();

    let mut qr_dynamic = DynamicImage::ImageRgba8(qr_img);

    let logo = image::load_from_memory(logo_bytes)
        .map_err(|e| QrisError::RenderError(format!("failed to load logo: {e}")))?;

    // Scale logo to 25% of the QR width
    let logo_size = qr_dynamic.width() / 4;
    let logo_scaled = logo.resize(logo_size, logo_size, imageops::FilterType::Lanczos3);

    // Centre the logo
    let x = (qr_dynamic.width() - logo_scaled.width()) / 2;
    let y = (qr_dynamic.height() - logo_scaled.height()) / 2;

    imageops::overlay(&mut qr_dynamic, &logo_scaled, x as i64, y as i64);

    let mut buf = Vec::new();
    qr_dynamic
        .write_to(&mut std::io::Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| QrisError::RenderError(e.to_string()))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_starts_with_png_magic() {
        // Use the builder to produce a real payload string
        let payload = crate::QrisBuilder::new()
            .nmid("ID1020001234567")
            .merchant_name("Test")
            .merchant_city("Jakarta")
            .merchant_category_code("5812")
            .build()
            .unwrap()
            .to_qris_string();

        let png = to_png(&payload, 300).unwrap();
        assert_eq!(
            &png[..4],
            b"\x89PNG",
            "output must start with PNG magic bytes"
        );
    }

    #[test]
    fn svg_contains_svg_tag() {
        let payload = crate::QrisBuilder::new()
            .nmid("ID1020001234567")
            .merchant_name("Test")
            .merchant_city("Jakarta")
            .merchant_category_code("5812")
            .build()
            .unwrap()
            .to_qris_string();

        let svg = to_svg(&payload).unwrap();
        assert!(svg.contains("<svg"), "output must contain an <svg> element");
    }
}
