//! A test executable accepting Blender arguments and emitting representative logs.
use std::{
    fs,
    io::{self, Write},
    path::PathBuf,
    time::{Duration, Instant},
};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let blend = PathBuf::from(&args[args.iter().position(|arg| arg == "-b").unwrap() + 1]);
    let mode = fs::read_to_string(&blend).unwrap();
    fs::write(blend.with_extension("args"), args.join("\n")).unwrap();
    println!("Fra:3 Mem:30.00M");
    println!("render | Time: 00:02.00 (Saving: 00:00.10)");
    eprintln!("fixture stderr");
    io::stdout().flush().unwrap();
    io::stderr().flush().unwrap();
    if mode == "wait" {
        let deadline = Instant::now() + Duration::from_secs(15);
        while !blend.with_extension("release").exists() {
            if Instant::now() > deadline {
                std::process::exit(99);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    std::process::exit(if mode == "fail" { 7 } else { 0 });
}
