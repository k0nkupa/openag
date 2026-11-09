# TURN for WebRTC join-without-VPN (optional)

STUN is enough when at least one side has a friendly NAT. Behind two strict (symmetric) NATs you need a TURN relay.
OpenAg never hosts one for you; run your own (a small VPS) and give the daemon the shared secret.

## coturn example (`/etc/turnserver.conf`)
```
listening-port=3478
tls-listening-port=5349
realm=turn.example.com
use-auth-secret
static-auth-secret=<a long random secret, 32+ chars>
fingerprint
no-multicast-peers
no-cli
# Never let the relay reach your own networks:
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
total-quota=20
```
Open UDP/TCP 3478 and 5349 (and the relay port range, default 49152-65535 UDP).

## Daemon environment (never in the DB or the API)
```
OPENAG_RTC_TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349
OPENAG_RTC_TURN_SECRET=<the same static-auth-secret>
```
The secret stays in the daemon environment (and is stripped from bot processes). The daemon derives SHORT-LIVED
credentials from it (coturn REST scheme: username `<expiry>:openag`, credential `base64(HMAC-SHA1(secret, username))`, 1 hour)
and hands those to its own peer and in each phone invite (`POST /rtc/invite`, field `turn`). `GET /rtc` only reports
`turn: true|false`.
