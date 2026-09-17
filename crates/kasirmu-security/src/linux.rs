/*
last audited 25-07-26 by RSA-Agent
crate: oz-security | status: SAFE | lint: N/A (platform-gated, source-reviewed on Windows host)
findings: SEC-2 embeds a private tokio Runtime and block_on per op — panics if invoked from an async context; SEC-9 set_secret is delete-then-create (non-atomic, crash loses secret), Delete errors swallowed via `let _ =`, "plain" OpenSession sends secrets unencrypted over D-Bus
next: reentrancy strategy for Runtime; atomic set; numeric error matching | perf: per-instance runtime + D-Bus connection is heavy for short-lived use
*/
//! Linux Secret Service (libsecret / DBus) implementation of [`Keyring`].
//!
//! Talks to the `org.freedesktop.secrets` DBus service to store and
//! retrieve secrets.

use crate::Keyring;
use crate::error::SecurityError;
use std::collections::HashMap;
use tokio::runtime::Runtime;
use zbus::Connection;
use zbus::zvariant::{OwnedObjectPath, Value};

const SECRET_SERVICE: &str = "org.freedesktop.secrets";
const SECRET_PATH: &str = "/org/freedesktop/secrets";
const SECRET_IFACE: &str = "org.freedesktop.Secret.Service";
const COLLECTION_IFACE: &str = "org.freedesktop.Secret.Collection";
const ITEM_IFACE: &str = "org.freedesktop.Secret.Item";

/// Linux Secret Service keyring.
///
/// Stores secrets in the FreeDesktop Secret Service using the
/// `org.freedesktop.secrets` DBus API.
pub struct LibSecretKeyring {
    rt: Runtime,
    conn: Connection,
}

impl LibSecretKeyring {
    /// Create a new libsecret keyring instance.
    pub fn new() -> Result<Self, SecurityError> {
        let rt = Runtime::new().map_err(|e| {
            SecurityError::KeyUnavailable(format!("failed to create tokio runtime: {e}"))
        })?;
        let conn = rt.block_on(Connection::session()).map_err(|e| {
            SecurityError::KeyUnavailable(format!("failed to connect to session D-Bus: {e}"))
        })?;
        Ok(Self { rt, conn })
    }

    async fn open_session(&self) -> Result<OwnedObjectPath, SecurityError> {
        let msg = self
            .conn
            .call_method(
                Some(SECRET_SERVICE),
                SECRET_PATH,
                Some(SECRET_IFACE),
                "OpenSession",
                &("plain", Value::new("")),
            )
            .await
            .map_err(|e| SecurityError::KeyUnavailable(format!("OpenSession failed: {e}")))?;
        let body = msg.body();
        let result: (Value<'_>, OwnedObjectPath) = body.deserialize().map_err(|e| {
            SecurityError::KeyUnavailable(format!("OpenSession body deserialize failed: {e}"))
        })?;
        Ok(result.1)
    }

    async fn default_collection(&self) -> Result<OwnedObjectPath, SecurityError> {
        let msg = self
            .conn
            .call_method(
                Some(SECRET_SERVICE),
                SECRET_PATH,
                Some(SECRET_IFACE),
                "ReadAlias",
                &("default",),
            )
            .await
            .map_err(|e| SecurityError::KeyUnavailable(format!("ReadAlias failed: {e}")))?;
        let body = msg.body();
        let path: OwnedObjectPath = body.deserialize().map_err(|e| {
            SecurityError::KeyUnavailable(format!("ReadAlias body deserialize failed: {e}"))
        })?;
        Ok(path)
    }

    async fn search_items(
        &self,
        attrs: &HashMap<String, String>,
    ) -> Result<Vec<OwnedObjectPath>, SecurityError> {
        let msg = self
            .conn
            .call_method(
                Some(SECRET_SERVICE),
                SECRET_PATH,
                Some(SECRET_IFACE),
                "SearchItems",
                &(attrs,),
            )
            .await
            .map_err(|e| SecurityError::KeyUnavailable(format!("SearchItems failed: {e}")))?;
        let body = msg.body();
        let (unlocked, _locked): (Vec<OwnedObjectPath>, Vec<OwnedObjectPath>) =
            body.deserialize().map_err(|e| {
                SecurityError::KeyUnavailable(format!("SearchItems body deserialize failed: {e}"))
            })?;
        Ok(unlocked)
    }
}

impl Keyring for LibSecretKeyring {
    fn get_secret(&self, name: &str) -> Result<Option<String>, SecurityError> {
        let attrs = attributes(name);
        let items = self.rt.block_on(self.search_items(&attrs))?;

        if items.is_empty() {
            return Ok(None);
        }

        let session = self.rt.block_on(self.open_session())?;

        let msg = self
            .rt
            .block_on(self.conn.call_method(
                Some(SECRET_SERVICE),
                &items[0],
                Some(ITEM_IFACE),
                "GetSecret",
                &(&session,),
            ))
            .map_err(|e| SecurityError::KeyUnavailable(format!("GetSecret failed: {e}")))?;
        let body = msg.body();
        let secret: (OwnedObjectPath, Vec<u8>, String) = body.deserialize().map_err(|e| {
            SecurityError::KeyUnavailable(format!("GetSecret body deserialize failed: {e}"))
        })?;

        let s = String::from_utf8(secret.1).map_err(|e| {
            SecurityError::KeyUnavailable(format!("secret is not valid UTF-8: {e}"))
        })?;

        Ok(Some(s))
    }

    fn set_secret(&self, name: &str, value: &str) -> Result<(), SecurityError> {
        let attrs = attributes(name);

        let session = self.rt.block_on(self.open_session())?;
        let collection = self.rt.block_on(self.default_collection())?;

        let items = self.rt.block_on(self.search_items(&attrs))?;
        for item_path in &items {
            let _ = self
                .rt
                .block_on(self.conn.call_method(
                    Some(SECRET_SERVICE),
                    item_path,
                    Some(ITEM_IFACE),
                    "Delete",
                    &(),
                ))
                .map_err(|e| SecurityError::KeyUnavailable(format!("Delete failed: {e}")));
        }

        let properties = HashMap::from([
            (
                "org.freedesktop.Secret.Item.Label".to_string(),
                Value::new(name.to_string()),
            ),
            (
                "org.freedesktop.Secret.Item.Attributes".to_string(),
                Value::new(attrs.clone()),
            ),
        ]);

        let secret: (OwnedObjectPath, Vec<u8>, String) =
            (session, value.as_bytes().to_vec(), "text/plain".to_string());

        let msg = self
            .rt
            .block_on(self.conn.call_method(
                Some(SECRET_SERVICE),
                &collection,
                Some(COLLECTION_IFACE),
                "CreateItem",
                &(properties, secret, true),
            ))
            .map_err(|e| SecurityError::KeyUnavailable(format!("CreateItem failed: {e}")))?;
        let body = msg.body();
        let (_item, _created): (OwnedObjectPath, bool) = body.deserialize().map_err(|e| {
            SecurityError::KeyUnavailable(format!("CreateItem body deserialize failed: {e}"))
        })?;

        Ok(())
    }

    fn delete_secret(&self, name: &str) -> Result<bool, SecurityError> {
        let attrs = attributes(name);
        let items = self.rt.block_on(self.search_items(&attrs))?;

        if items.is_empty() {
            return Ok(false);
        }

        for item_path in &items {
            self.rt
                .block_on(self.conn.call_method(
                    Some(SECRET_SERVICE),
                    item_path,
                    Some(ITEM_IFACE),
                    "Delete",
                    &(),
                ))
                .map_err(|e| SecurityError::KeyUnavailable(format!("Delete failed: {e}")))?;
        }

        Ok(true)
    }

    // `rotate_key` and `key_created_at` use the default implementations
    // from the `Keyring` trait.
}

fn attributes(name: &str) -> HashMap<String, String> {
    HashMap::from([
        ("application".to_string(), "oz-pos".to_string()),
        ("oz-pos-name".to_string(), name.to_string()),
    ])
}

#[cfg(test)]
#[path = "linux_tests.rs"]
mod tests;
