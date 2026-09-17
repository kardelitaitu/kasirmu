//! EDC protocol codecs — stub coverage.
//!
//! The codecs carry no logic until the real vendor framing lands, so these
//! tests pin the two things that are load-bearing today: the vendor names
//! the transport layer keys off, and the fail-closed contract that stops an
//! unimplemented codec from ever looking like a decoded approval.

use oz_core::{Currency, Money};

use super::ingenico::IngenicoCodec;
use super::pax::PaxCodec;
use super::verifone::VerifoneCodec;
use super::{ProtocolCodec, ProtocolMessage};

fn usd(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: "USD".parse::<Currency>().unwrap(),
    }
}

#[test]
fn vendor_names_are_stable() {
    // The transport and the edc_terminals table both key off these.
    assert_eq!(IngenicoCodec.vendor(), "ingenico");
    assert_eq!(VerifoneCodec.vendor(), "verifone");
    assert_eq!(PaxCodec.vendor(), "pax");
}

#[test]
fn every_codec_method_fails_closed() {
    let codecs: Vec<&dyn ProtocolCodec> = vec![&IngenicoCodec, &PaxCodec, &VerifoneCodec];
    for codec in codecs {
        let vendor = codec.vendor();

        let sale = codec.encode_sale(usd(1000), "ref-1");
        assert!(
            matches!(sale, Err(crate::error::HalError::Unsupported(_))),
            "{vendor}.encode_sale must not succeed while stubbed"
        );

        let refund = codec.encode_refund(usd(1000), "txn-1");
        assert!(
            matches!(refund, Err(crate::error::HalError::Unsupported(_))),
            "{vendor}.encode_refund must not succeed while stubbed"
        );

        let void = codec.encode_void("txn-1");
        assert!(
            matches!(void, Err(crate::error::HalError::Unsupported(_))),
            "{vendor}.encode_void must not succeed while stubbed"
        );

        let decoded = codec.decode(&[0x00, 0x01, 0x02]);
        assert!(
            matches!(decoded, Err(crate::error::HalError::Unsupported(_))),
            "{vendor}.decode must not succeed while stubbed"
        );
    }
}

#[test]
fn stub_error_names_the_vendor_and_method() {
    let err = PaxCodec.encode_void("txn-9").unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("pax"), "vendor missing from: {msg}");
    assert!(msg.contains("encode_void"), "method missing from: {msg}");
}

#[test]
fn protocol_message_variants_hold_their_payloads() {
    // The state machine a real driver will build reads these fields, so
    // pin the shape now rather than after three vendors depend on it.
    let msg = ProtocolMessage::Authorised {
        transaction_id: "txn-1".into(),
        auth_code: "001234".into(),
        card_scheme: Some("VISA".into()),
        card_last4: Some("1111".into()),
    };
    match msg {
        ProtocolMessage::Authorised {
            transaction_id,
            auth_code,
            card_scheme,
            card_last4,
        } => {
            assert_eq!(transaction_id, "txn-1");
            assert_eq!(auth_code, "001234");
            assert_eq!(card_scheme.as_deref(), Some("VISA"));
            assert_eq!(card_last4.as_deref(), Some("1111"));
        }
        other => panic!("expected Authorised, got {other:?}"),
    }

    assert!(matches!(
        ProtocolMessage::Raw(vec![0x01, 0x02]),
        ProtocolMessage::Raw(_)
    ));
}
