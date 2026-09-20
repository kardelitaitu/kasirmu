//! Android Bluetooth (SPP/RFCOMM) transport â€” the Android counterpart of
//! [`crate::transport::serial`].
//!
//! Android exposes no `/dev/rfcomm*` to applications (see the manifest note
//! in apps/mobile-tauri), so the Serial Port Profile has to be driven through
//! the Java stack: `BluetoothAdapter` â†’ `createRfcommSocketToServiceRecord`
//! â†’ the socket's `InputStream`/`OutputStream`, reached over JNI.
//!
//! # How the JavaVM arrives here
//!
//! Nothing in the tauri/tao/wry stack (2.11.3 / 0.35.3 / 0.55.1 â€” measured in
//! the vendored sources) hands application code a `JavaVM`, and none of them
//! defines `JNI_OnLoad`. When Android's runtime loads the single app library
//! (`libkasirmu_mobile_lib.so`, which statically contains this crate), ART
//! therefore calls **our** `JNI_OnLoad` below, and we stash the VM. The
//! desktop build never compiles any of this (`cfg(target_os = "android")`),
//! so the host paths are untouched. If `JNI_OnLoad` somehow did not run, the
//! transport fails with [`HalError::Bluetooth`] â€” it never panics.
//!
//! # Threading
//!
//! Every JNI call attaches the calling thread to the JVM on demand
//! (`attach_current_thread`). The driver always invokes this module from
//! `spawn_blocking`, so a blocking `connect()` never stalls a runtime worker
//! or the Android main thread (a >5 s connect on the main thread is an ANR).

// RUST-06 scoped exception: the Android Bluetooth transport is JNI by
// nature (raw VM pointer in JNI_OnLoad, i8/u8 byte-array casts). The allow
// is confined to this android-only module; every `unsafe` block carries its
// own justification.
#![allow(unsafe_code)]

use std::io;
use std::sync::Mutex;

use jni::{
    JNIEnv, JavaVM,
    objects::{GlobalRef, JObject, JString, JValue},
    sys::{JNI_VERSION_1_6, jint},
};

use crate::error::HalError;

/// The Serial Port Profile service UUID. Every SPP device answers this.
pub const SPP_UUID: &str = "00001101-0000-1000-8000-00805F9B34FB";

// `jni::JavaVM` is not `Clone` on 0.21, so the VM lives behind the mutex and
// every caller works through a shared reference (`attach_current_thread`
// takes `&self`).
static VM: Mutex<Option<JavaVM>> = Mutex::new(None);

/// Store the JVM captured by [`JNI_OnLoad`]. Idempotent; the last writer wins.
pub fn set_java_vm(vm: JavaVM) {
    // A poisoned lock still holds the previous value, which is better than a
    // panic inside JNI_OnLoad (ART would abort the process over that).
    match VM.lock() {
        Ok(mut guard) => *guard = Some(vm),
        Err(poisoned) => *poisoned.into_inner() = Some(vm),
    }
}

/// Attach the calling thread and run `f` with the guard.
pub(crate) fn with_env<T>(
    f: impl FnOnce(&mut JNIEnv) -> jni::errors::Result<T>,
) -> Result<T, HalError> {
    let guard = match VM.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let vm = guard.as_ref().ok_or_else(|| {
        HalError::Bluetooth("JNI VM not captured (JNI_OnLoad did not run)".into())
    })?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| HalError::Bluetooth(format!("jni attach: {e}")))?;
    f(&mut env).map_err(|e| {
        // An un-cleared Java exception poisons every later JNI call on this
        // thread, so surface its own message when one is pending and fall
        // back to the Rust-side JNI error text otherwise.
        if env.exception_check().unwrap_or(false) {
            exception_message(&mut env)
        } else {
            HalError::Bluetooth(format!("jni: {e}"))
        }
    })
}

/// Best-effort extraction of the pending Java exception's message.
fn exception_message(env: &mut JNIEnv) -> HalError {
    let mut text = String::new();
    if let Ok(throwable) = env.exception_occurred() {
        if let Ok(value) = env.call_method(&throwable, "getMessage", "()Ljava/lang/String;", &[]) {
            if let Ok(obj) = value.l() {
                let jstr: JString = obj.into();
                if let Ok(s) = env.get_string(&jstr) {
                    text = s.to_string_lossy().into_owned();
                }
            }
        }
    }
    let _ = env.exception_clear();
    HalError::Bluetooth(if text.is_empty() {
        "java exception (no message)".into()
    } else {
        text
    })
}

/// Fetch a `java.lang.String` result as a Rust `String`.
fn java_string(env: &mut JNIEnv, obj: JObject<'_>) -> jni::errors::Result<String> {
    let jstr: JString = obj.into();
    Ok(env.get_string(&jstr)?.to_string_lossy().into_owned())
}

/// A bonded (paired) Bluetooth device as Android reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BtPairedDevice {
    /// MAC address â€” the identity the registry and the saved profile key on.
    pub address: String,
    /// Human-readable name; may be empty when `BLUETOOTH_CONNECT` is
    /// ungranted (API 31+ gates `getName` behind the runtime permission).
    pub name: String,
}

/// `BluetoothAdapter.getDefaultAdapter()` as a local reference.
fn default_adapter<'local>(env: &mut JNIEnv<'local>) -> jni::errors::Result<JObject<'local>> {
    env.call_static_method(
        "android/bluetooth/BluetoothAdapter",
        "getDefaultAdapter",
        "()Landroid/bluetooth/BluetoothAdapter;",
        &[],
    )?
    .l()
}

/// List bonded (paired) Bluetooth devices.
///
/// `getName` needs the `BLUETOOTH_CONNECT` runtime permission on API 31+;
/// when it is missing the name falls back to the address instead of failing,
/// because connecting only needs the address.
pub fn paired_devices() -> Result<Vec<BtPairedDevice>, HalError> {
    with_env(|env| {
        let adapter = default_adapter(env)?;
        if adapter.is_null() {
            return Ok(Vec::new());
        }
        let set = env
            .call_method(&adapter, "getBondedDevices", "()Ljava/util/Set;", &[])?
            .l()?;
        if set.is_null() {
            return Ok(Vec::new());
        }
        let array = env
            .call_method(&set, "toArray", "()[Ljava/lang/Object;", &[])?
            .l()?;
        let raw = array.as_raw();
        let array = unsafe { jni::objects::JObjectArray::from_raw(raw) };
        let len = env.get_array_length(&array)?;
        let mut devices = Vec::with_capacity(len.max(0) as usize);
        for i in 0..len {
            let device = env.get_object_array_element(&array, i)?;
            let address = env
                .call_method(&device, "getAddress", "()Ljava/lang/String;", &[])
                .and_then(|v| v.l())
                .and_then(|s| java_string(env, s))?;
            let name = env
                .call_method(&device, "getName", "()Ljava/lang/String;", &[])
                .and_then(|v| v.l())
                .and_then(|s| java_string(env, s))
                .unwrap_or_else(|_| address.clone());
            let _ = env.exception_clear();
            devices.push(BtPairedDevice { address, name });
        }
        Ok(devices)
    })
}

/// A connected RFCOMM (SPP) socket: a [`std::io::Read`] + [`std::io::Write`]
/// byte stream backed by the socket's `InputStream`/`OutputStream`.
///
/// Holds global references, so the stream may be moved between threads
/// (`Send + Sync`) exactly like the `Box<dyn SerialPort>` it replaces.
/// `Drop` closes the socket â€” dropping the printer drops the link.
pub struct BtRfcommStream {
    socket: GlobalRef,
    input: GlobalRef,
    output: GlobalRef,
}

impl BtRfcommStream {
    /// Open an SPP RFCOMM connection to the paired device at `address`
    /// (a MAC address, e.g. `"66:12:34:AB:CD:EF"`).
    ///
    /// Blocking: run it from `spawn_blocking` (the driver does).
    pub fn connect(address: &str) -> Result<Self, HalError> {
        // jni::Error has no app-level variant, so a missing adapter is
        // detected in a first pass and surfaced as a HalError here rather
        // than masquerading as a JNI failure inside the closure below.
        let adapter_absent = with_env(|env| default_adapter(env).map(|a| a.is_null()))?;
        if adapter_absent {
            return Err(HalError::Bluetooth("BluetoothAdapter unavailable".into()));
        }
        with_env(|env| {
            let adapter = default_adapter(env)?;
            // Discovery holds the radio; Android fails an outgoing connect
            // while it runs, so cancel it first (best effort, may be absent).
            env.call_method(&adapter, "cancelDiscovery", "()Z", &[])
                .map(|_| ())
                .or_else(|_| env.exception_clear())?;

            let device = env
                .call_method(
                    &adapter,
                    "getRemoteDevice",
                    "(Ljava/lang/String;)Landroid/bluetooth/BluetoothDevice;",
                    &[JValue::Object(&env.new_string(address)?.into())],
                )?
                .l()?;
            let uuid = env
                .call_static_method(
                    "java/util/UUID",
                    "fromString",
                    "(Ljava/lang/String;)Ljava/util/UUID;",
                    &[JValue::Object(&env.new_string(SPP_UUID)?.into())],
                )?
                .l()?;
            let socket = env
                .call_method(
                    &device,
                    "createRfcommSocketToServiceRecord",
                    "(Ljava/util/UUID;)Landroid/bluetooth/BluetoothSocket;",
                    &[JValue::Object(&uuid)],
                )?
                .l()?;
            // Throws IOException (unreachable) or SecurityException
            // (BLUETOOTH_CONNECT ungranted on API 31+); with_env surfaces
            // the exception's own message either way.
            env.call_method(&socket, "connect", "()V", &[])?;
            let input = env
                .call_method(&socket, "getInputStream", "()Ljava/io/InputStream;", &[])?
                .l()?;
            let output = env
                .call_method(&socket, "getOutputStream", "()Ljava/io/OutputStream;", &[])?
                .l()?;
            Ok(Self {
                socket: env.new_global_ref(&socket)?,
                input: env.new_global_ref(&input)?,
                output: env.new_global_ref(&output)?,
            })
        })
    }

    /// Close the socket. Best effort â€” errors are returned, not panicked.
    pub fn close(&self) -> Result<(), HalError> {
        with_env(|env| {
            env.call_method(self.socket.as_obj(), "close", "()V", &[])
                .map(|_| ())
        })
    }
}

impl io::Write for BtRfcommStream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        with_env(|env| {
            let bytes = env.new_byte_array(buf.len() as jint)?;
            // SAFETY: `buf` is a valid `&[u8]`; `i8` and `u8` have identical layout.
            let as_i8 = unsafe { std::slice::from_raw_parts(buf.as_ptr().cast::<i8>(), buf.len()) };
            env.set_byte_array_region(&bytes, 0, as_i8)?;
            // OutputStream.write(byte[]) writes the whole array or throws.
            env.call_method(
                self.output.as_obj(),
                "write",
                "([B)V",
                &[JValue::Object(&bytes)],
            )
            .map(|_| buf.len())
        })
        .map_err(io::Error::other)
    }

    fn flush(&mut self) -> io::Result<()> {
        with_env(|env| {
            env.call_method(self.output.as_obj(), "flush", "()V", &[])
                .map(|_| ())
        })
        .map_err(io::Error::other)
    }
}

impl io::Read for BtRfcommStream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        with_env(|env| {
            let bytes = env.new_byte_array(buf.len() as jint)?;
            let n = env
                .call_method(
                    self.input.as_obj(),
                    "read",
                    "([B)I",
                    &[JValue::Object(&bytes)],
                )?
                .i()?;
            if n <= 0 {
                return Ok(0); // 0 == EOF on a stream that blocks otherwise
            }
            // SAFETY: writing back into our own `buf`, `n` elements; `i8`
            // and `u8` have identical layout.
            let as_i8 = unsafe {
                std::slice::from_raw_parts_mut(buf.as_mut_ptr().cast::<i8>(), n as usize)
            };
            env.get_byte_array_region(&bytes, 0, as_i8)?;
            Ok(n as usize)
        })
        .map_err(io::Error::other)
    }
}

impl Drop for BtRfcommStream {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

/// Called once by ART when the app library is loaded. Captures the JVM.
///
/// # Safety
/// Invoked by the JVM; `vm` must be the pointer ART passed in.
#[unsafe(no_mangle)]
pub extern "system" fn JNI_OnLoad(
    vm: *mut jni::sys::JavaVM,
    _reserved: *mut std::ffi::c_void,
) -> jint {
    // SAFETY: `JNI_OnLoad` receives a valid `JavaVM` pointer from ART.
    match unsafe { JavaVM::from_raw(vm) } {
        Ok(vm) => {
            set_java_vm(vm);
            JNI_VERSION_1_6
        }
        Err(_) => jni::sys::JNI_ERR,
    }
}

#[cfg(test)]
#[path = "bt_android_tests.rs"]
mod tests;
