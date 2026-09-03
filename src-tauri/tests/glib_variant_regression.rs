#![cfg(target_os = "linux")]

use glib::prelude::*;

fn strings() -> glib::Variant {
    ["alpha", "été", "", "終"].as_slice().to_variant()
}

#[test]
fn variant_str_next_preserves_borrowed_strings() {
    let variant = strings();
    let mut iter = variant.array_iter_str().unwrap();
    let first = iter.next().unwrap();
    let second = iter.next().unwrap();
    assert_eq!((first, second), ("alpha", "été"));
    assert_eq!(iter.collect::<Vec<_>>(), ["", "終"]);
}

#[test]
fn variant_str_next_back_preserves_empty_and_unicode_strings() {
    let variant = strings();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.next_back(), Some("終"));
    assert_eq!(iter.next_back(), Some(""));
    assert_eq!(iter.collect::<Vec<_>>(), ["alpha", "été"]);
}

#[test]
fn variant_str_nth_reads_the_selected_child() {
    let variant = strings();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.nth(1), Some("été"));
    assert_eq!(iter.next(), Some(""));
}

#[test]
fn variant_str_nth_back_reads_the_selected_child() {
    let variant = strings();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.nth_back(1), Some(""));
    assert_eq!(iter.next_back(), Some("été"));
}

#[test]
fn variant_str_last_reads_the_last_child() {
    let variant = strings();
    assert_eq!(variant.array_iter_str().unwrap().last(), Some("終"));
}

#[test]
fn variant_str_empty_array_stays_exhausted() {
    let variant = Vec::<String>::new().to_variant();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(iter.nth(1), None);
    assert_eq!(iter.nth_back(1), None);
    assert_eq!(iter.last(), None);
}
