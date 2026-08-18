#[tauri::command]
pub fn system_dictation_is_supported() -> bool {
    // This app only targets Windows/macOS, but keep this as a queryable capability so
    // the frontend can hide the mic affordance in unexpected environments.
    cfg!(target_os = "windows") || cfg!(target_os = "macos")
}

#[tauri::command]
pub fn system_dictation_trigger(macos_shortcut: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = macos_shortcut;
        return windows_trigger();
    }

    #[cfg(target_os = "macos")]
    {
        let shortcut = macos_shortcut.unwrap_or_else(|| "fn_double".to_string());
        if shortcut == "ctrl_double" {
            return macos_trigger_double_ctrl();
        }
        return macos_trigger_double_fn();
    }

    #[allow(unreachable_code)]
    Err("System dictation is not supported on this platform.".to_string())
}

#[tauri::command]
pub fn system_dictation_dismiss() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return windows_dismiss();
    }

    #[cfg(target_os = "macos")]
    {
        // macOS Dictation UI varies by configuration; don't try to force-close it for now.
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("System dictation is not supported on this platform.".to_string())
}

#[cfg(target_os = "macos")]
fn macos_trigger_double_ctrl() -> Result<(), String> {
    // Best-effort: simulate "Press Control key twice" (a common, configurable Dictation shortcut).
    const KVK_CONTROL: u16 = 0x3B; // kVK_Control
    macos_post_virtual_key_double(KVK_CONTROL, "Control")
}

#[cfg(target_os = "windows")]
fn windows_trigger() -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_H, VK_LWIN,
    };

    // Press: Win down, H down, H up, Win up.
    // Note: SendInput returns the number of events successfully inserted.
    unsafe fn key(vk: u16, key_up: bool) -> INPUT {
        let ki = KEYBDINPUT {
            wVk: vk,
            wScan: 0,
            dwFlags: if key_up { KEYEVENTF_KEYUP } else { 0 },
            time: 0,
            dwExtraInfo: 0,
        };
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki },
        }
    }

    let mut inputs = vec![
        unsafe { key(VK_LWIN as u16, false) },
        unsafe { key(VK_H as u16, false) },
        unsafe { key(VK_H as u16, true) },
        unsafe { key(VK_LWIN as u16, true) },
    ];

    let inserted = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if inserted == inputs.len() as u32 {
        Ok(())
    } else {
        Err(format!("Failed to trigger Windows voice typing (Win+H). SendInput inserted {inserted}/{} events.", inputs.len()))
    }
}

#[cfg(target_os = "windows")]
fn windows_dismiss() -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_ESCAPE,
    };

    unsafe fn key(vk: u16, key_up: bool) -> INPUT {
        let ki = KEYBDINPUT {
            wVk: vk,
            wScan: 0,
            dwFlags: if key_up { KEYEVENTF_KEYUP } else { 0 },
            time: 0,
            dwExtraInfo: 0,
        };
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki },
        }
    }

    let mut inputs = vec![unsafe { key(VK_ESCAPE as u16, false) }, unsafe {
        key(VK_ESCAPE as u16, true)
    }];
    let inserted = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if inserted == inputs.len() as u32 {
        Ok(())
    } else {
        Err(format!(
            "Failed to dismiss Windows voice typing UI. SendInput inserted {inserted}/{} events.",
            inputs.len()
        ))
    }
}

#[cfg(target_os = "macos")]
fn macos_trigger_double_fn() -> Result<(), String> {
    // Best-effort: simulate "Press Fn key twice" (default macOS Dictation shortcut).
    //
    // Fn is a modifier-like virtual key; generating events for it is not guaranteed to work
    // on all hardware / system configurations. If it doesn't, users can still use the OS
    // shortcut directly (Fn Fn) and we can later add an alternate shortcut setting.
    const KVK_FUNCTION: u16 = 0x3F; // kVK_Function
    macos_post_virtual_key_double(KVK_FUNCTION, "Fn")
}

#[cfg(target_os = "macos")]
fn macos_post_virtual_key_double(virtual_key: u16, key_name: &'static str) -> Result<(), String> {
    // Note: generating synthetic key events may require Accessibility permissions on macOS.
    unsafe {
        // See: ApplicationServices / CoreGraphics.
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn CGEventCreateKeyboardEvent(
                source: *const std::ffi::c_void,
                virtualKey: u16,
                keyDown: bool,
            ) -> *mut std::ffi::c_void;
            fn CGEventPost(tap: i32, event: *mut std::ffi::c_void);
            fn CFRelease(cf: *const std::ffi::c_void);
        }

        const K_CG_HID_EVENT_TAP: i32 = 0; // kCGHIDEventTap

        let post = |down: bool| -> Result<(), String> {
            let event = CGEventCreateKeyboardEvent(std::ptr::null(), virtual_key, down);
            if event.is_null() {
                return Err(format!("Failed to create CGEvent for {key_name} key."));
            }
            CGEventPost(K_CG_HID_EVENT_TAP, event);
            CFRelease(event);
            Ok(())
        };

        post(true)?;
        post(false)?;
        std::thread::sleep(std::time::Duration::from_millis(60));
        post(true)?;
        post(false)?;
    }

    Ok(())
}
