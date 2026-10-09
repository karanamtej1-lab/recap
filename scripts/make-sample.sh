#!/usr/bin/env bash
# Builds public/sample/lecture.mp4: original lecture script -> macOS TTS -> slide video.
# Audio is joined as continuous PCM first: concatenating per-part AAC files leaves
# timestamp gaps that <video> plays as silence but decodeAudioData silently drops.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
n=$(python3 scripts/slides.py scripts/lecture.txt "$tmp")
: > "$tmp/audio.txt"
: > "$tmp/slides.txt"
for ((i = 0; i < n; i++)); do
  say -v Samantha -r 175 -o "$tmp/a$i.aiff" -f "$tmp/text$i.txt"
  ffmpeg -loglevel error -y -i "$tmp/a$i.aiff" -af "apad=pad_dur=1.2" -ar 44100 -ac 1 -c:a pcm_s16le "$tmp/a$i.wav"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$tmp/a$i.wav")
  echo "file '$tmp/a$i.wav'" >> "$tmp/audio.txt"
  printf "file '%s'\nduration %s\n" "$tmp/slide$i.png" "$d" >> "$tmp/slides.txt"
done
echo "file '$tmp/slide$((n - 1)).png'" >> "$tmp/slides.txt" # concat demuxer needs the last image twice
ffmpeg -loglevel error -y -f concat -safe 0 -i "$tmp/audio.txt" -c copy "$tmp/audio.wav"
mkdir -p public/sample
ffmpeg -loglevel error -y -f concat -safe 0 -i "$tmp/slides.txt" -i "$tmp/audio.wav" \
  -c:v libx264 -tune stillimage -pix_fmt yuv420p -r 15 -c:a aac -b:a 96k -t "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$tmp/audio.wav")" -movflags +faststart \
  public/sample/lecture.mp4
rm -rf "$tmp"
ls -lh public/sample/lecture.mp4
