#!/bin/sh
# Checks the App Attest verifier (src/appAttest.ts) against a full fake
# chain made here — a stand-in root and intermediate (P-384) and a phone
# key (P-256), in Apple's exact format — then six forgeries and three
# assertion attacks. Every line should start with OK.
#   sh server/test/run-attest-test.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
cd "$W"
openssl ecparam -name secp384r1 -genkey -noout -out root.key 2>/dev/null
openssl req -x509 -new -key root.key -sha384 -days 30 -subj "/CN=Test Root" -out root.pem 2>/dev/null
openssl ecparam -name secp384r1 -genkey -noout -out int.key 2>/dev/null
openssl req -new -key int.key -subj "/CN=Test Intermediate" -out int.csr 2>/dev/null
printf "basicConstraints=critical,CA:true\n" > int.ext
openssl x509 -req -in int.csr -CA root.pem -CAkey root.key -CAcreateserial -sha384 -days 30 -extfile int.ext -out int.pem 2>/dev/null
openssl ecparam -name prime256v1 -genkey -noout -out leaf.key 2>/dev/null
openssl pkcs8 -topk8 -nocrypt -in leaf.key -out leaf.p8
node --experimental-strip-types --no-warnings "$HERE/appAttest.test.ts"
