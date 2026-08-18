package security

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

const HeaderSignature = "X-Hermes-Signature"

// SignPayload returns hex-encoded HMAC-SHA256 of body.
func SignPayload(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// FormatHeader builds "sha256=<hex>" header value.
func FormatHeader(hexDigest string) string {
	return "sha256=" + hexDigest
}

// VerifyHeader checks X-Hermes-Signature against body.
// Accepts "sha256=<hex>" or raw hex.
func VerifyHeader(secret, header string, body []byte) error {
	if secret == "" {
		return fmt.Errorf("hmac secret not configured")
	}
	got := strings.TrimSpace(header)
	if got == "" {
		return fmt.Errorf("missing %s", HeaderSignature)
	}
	const prefix = "sha256="
	if strings.HasPrefix(strings.ToLower(got), prefix) {
		got = got[len(prefix):]
	}
	want := SignPayload(secret, body)
	a, err1 := hex.DecodeString(got)
	b, err2 := hex.DecodeString(want)
	if err1 != nil || err2 != nil || len(a) != len(b) {
		return fmt.Errorf("invalid signature")
	}
	if !hmac.Equal(a, b) {
		return fmt.Errorf("signature mismatch")
	}
	return nil
}
