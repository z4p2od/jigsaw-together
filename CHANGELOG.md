# Changelog

## Unreleased — VS Mode improvements
- Rematch offer/accept flow: either player can offer, other sees a pulsing Accept button; both are auto-redirected to a new room with no lobby/ready screen
- Win counter displayed in result screen, persists across rematches in the session
- Emoji reactions in VS mode fly on the **opponent's** board (sender sees theirs on opp board, receiver sees it on their own)
- Emoji animations use `position: fixed` + `getBoundingClientRect` — no longer clipped by overflow containers
- Rooms disappear from the open rooms browser as soon as the game starts
- Fix: rematch offer state used per-player Firebase paths (`rematchOffers/{playerId}`) to prevent overwrite race condition

## VS Mode enhancements
- Piece count (24/100/250) and mode (Normal/Hard 🔥) selectable before creating a room
- Open rooms browser (`/vs-rooms`): live list of waiting rooms, join without a share link
- Side-by-side split boards: your board (interactive) left, opponent's (read-only, live) right
- Chat + emoji reactions in VS mode
- Hard mode in VS: pieces start with same random rotations for both players (seeded); right-click/double-tap to rotate

## VS Mode
- 1v1 competitive puzzle racing: same image, same grid, same initial scatter (seeded RNG)
- Lobby with player slots, ready buttons, share link
- 3-2-1-GO countdown
- Each player controls only their own pieces
- Opponent progress bar updates in real time
- First to finish wins; result screen with times for both players
- VS rooms use images from the POTD pool
- VS rooms cleaned up after 24h by cron

## Chat + Emoji Reactions
- Chat panel (bottom-left, FB Messenger style popup) with unread badge
- Emoji quick-send buttons
- Emoji reactions float across the board (6 copies, scattered randomly)

## Puzzle of the Day
- Three daily difficulties: Easy (25 pieces), Medium (100 pieces), Hard (100 pieces, rotated)
- Each player gets a private puzzle clone — independent progress and timer
- Daily leaderboard on landing page and completion screen
- Resets at midnight Greek time (22:00 UTC cron)

## Cloudinary + Hard Mode
- Images stored on Cloudinary instead of Firebase base64
- Hard mode: pieces start randomly rotated; right-click or double-tap to rotate
- Hard mode badge shown in puzzle header

## Core Puzzle
- Upload image → generate grid with interlocking tab/slot edges
- Real-time multiplayer sync via Firebase Realtime Database
- Pieces snap together using edge ID matching (only truly adjacent pieces snap)
- Groups: connected pieces drag and rotate as one unit
- Player avatars shown on pieces locked by other players (top-right of group only)
- Pinch-to-zoom (mobile), scroll to pan
- Shared timer, piece count progress display
- Player presence dots in header
