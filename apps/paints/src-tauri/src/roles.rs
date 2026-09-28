//! iRacing names a car's textures `<role>_<customerId>.<ext>`.
//!
//! The role list below is not a guess: it is what actually turns up in a populated
//! `Documents\iRacing\paint`. Trading Paints delivers other drivers' spec maps as
//! pre-cooked `.mip`, so a `car_spec_<id>.tga` on disk is nearly always a paint someone
//! installed by hand. `customer` leans on that.

/// Car roles, longest prefix first — `car_spec_123.tga` also matches the bare `car_`
/// prefix, so order is load-bearing and every lookup must walk this list in sequence.
pub const CAR_ROLES: &[&str] = &["car_spec", "car_decal", "car_num", "car"];

/// Extensions the sim reads. `.tga` is the source; `.mip` is the sim's cooked cache.
pub const TEXTURE_EXT: &str = "tga";
pub const COOKED_EXT: &str = "mip";

/// Split an installed filename into `(role, customer_id, extension)`.
///
/// `car_spec_424242.tga` -> `("car_spec", "424242", "tga")`
/// Returns `None` for anything that is not `<known role>_<digits>.<ext>`, which is how
/// helmets, suits and stray files stay out of the way.
pub fn parse_installed(file_name: &str) -> Option<(&'static str, String, String)> {
    let (stem, ext) = file_name.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    if ext != TEXTURE_EXT && ext != COOKED_EXT {
        return None;
    }
    let lower = stem.to_ascii_lowercase();
    for role in CAR_ROLES {
        let prefix = format!("{role}_");
        if let Some(rest) = lower.strip_prefix(&prefix) {
            if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
                return Some((role, rest.to_string(), ext));
            }
        }
    }
    None
}

/// Work out which role a file inside a library version folder plays.
///
/// Two shapes are accepted, because both exist in the wild:
///   * the plan's shape, `car.tga` / `car_spec.tga` — no customer id
///   * the shape the design pipeline already emits, `car_424242.tga` — with an id
///
/// Previews (`preview*.png`) and `meta.json` are deliberately not roles.
pub fn parse_library_file(file_name: &str) -> Option<&'static str> {
    let (stem, ext) = file_name.rsplit_once('.')?;
    if !ext.eq_ignore_ascii_case(TEXTURE_EXT) {
        return None;
    }
    let lower = stem.to_ascii_lowercase();
    for role in CAR_ROLES {
        if lower == *role {
            return Some(role);
        }
        let prefix = format!("{role}_");
        if let Some(rest) = lower.strip_prefix(&prefix) {
            if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
                return Some(role);
            }
        }
    }
    None
}

/// The name a role must take once installed for a given customer.
pub fn installed_name(role: &str, customer_id: &str, ext: &str) -> String {
    format!("{role}_{customer_id}.{ext}")
}

/// Human label for a role, for the UI.
pub fn role_label(role: &str) -> &'static str {
    match role {
        "car" => "Paint",
        "car_spec" => "Spec map",
        "car_decal" => "Decal",
        "car_num" => "Number",
        _ => "Texture",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longest_role_prefix_wins() {
        // The whole point of the ordered role list.
        assert_eq!(parse_installed("car_spec_424242.tga").unwrap().0, "car_spec");
        assert_eq!(parse_installed("car_424242.tga").unwrap().0, "car");
        assert_eq!(parse_installed("car_decal_42.tga").unwrap().0, "car_decal");
    }

    #[test]
    fn installed_parses_id_and_ext() {
        let (role, id, ext) = parse_installed("car_spec_424242.mip").unwrap();
        assert_eq!((role, id.as_str(), ext.as_str()), ("car_spec", "424242", "mip"));
    }

    #[test]
    fn non_car_files_are_ignored() {
        // Helmets and suits live in the paint root and belong to whoever you raced.
        assert!(parse_installed("helmet_424242.tga").is_none());
        assert!(parse_installed("suit_424242.tga").is_none());
        assert!(parse_installed("car_notanid.tga").is_none());
        assert!(parse_installed("preview.png").is_none());
    }

    #[test]
    fn library_accepts_both_shapes() {
        assert_eq!(parse_library_file("car.tga"), Some("car"));
        assert_eq!(parse_library_file("car_spec.tga"), Some("car_spec"));
        assert_eq!(parse_library_file("car_424242.tga"), Some("car"));
        assert_eq!(parse_library_file("car_spec_424242.tga"), Some("car_spec"));
        assert_eq!(parse_library_file("preview_side.png"), None);
        assert_eq!(parse_library_file("meta.json"), None);
    }

    #[test]
    fn rename_for_install() {
        assert_eq!(installed_name("car_spec", "424242", "tga"), "car_spec_424242.tga");
    }
}
