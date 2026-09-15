//! QR code image decoding — converts a QR image into the raw QRIS string.
//!
//! Enabled by the `decode` feature flag.

use crate::error::QrisError;

/// Decode a QR code from an image file and return the raw QRIS payload string.
///
/// Supported formats: JPEG, PNG (and any format supported by the `image` crate
/// with the features enabled in your `Cargo.toml`).
///
/// # Errors
/// - [`QrisError::Io`] — file cannot be opened
/// - [`QrisError::DecodeError`] — no QR code found, or the QR could not be decoded
pub fn decode_image_file(path: impl AsRef<std::path::Path>) -> Result<String, QrisError> {
    let img = image::open(path.as_ref())
        .map_err(|e| QrisError::DecodeError(format!("failed to open image: {e}")))?
        .to_luma8();
    decode_luma(img)
}

/// Decode a QR code from raw image bytes and return the raw QRIS payload string.
///
/// # Errors
/// - [`QrisError::DecodeError`] — image format unrecognised, no QR code found,
///   or the QR could not be decoded
pub fn decode_image_bytes(bytes: &[u8]) -> Result<String, QrisError> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| QrisError::DecodeError(format!("failed to load image from bytes: {e}")))?
        .to_luma8();
    decode_luma(img)
}

fn decode_luma(img: image::GrayImage) -> Result<String, QrisError> {
    let (width, height) = img.dimensions();
    let raw = img.into_raw();
    let w = width as usize;
    let h = height as usize;

    let mut prepared = rqrr::PreparedImage::prepare_from_greyscale(w, h, |x, y| {
        raw[y * w + x]
    });
    let grids = prepared.detect_grids();

    if grids.is_empty() {
        return Err(QrisError::DecodeError(
            "no QR code grid detected in image".to_string(),
        ));
    }

    for grid in grids {
        match grid.decode() {
            Ok((_, content)) => return Ok(content),
            Err(e) => {
                // Try remaining grids before giving up
                let _ = e;
            }
        }
    }

    Err(QrisError::DecodeError(
        "QR code grid(s) found but none could be decoded".to_string(),
    ))
}

