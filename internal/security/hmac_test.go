package security

import "testing"

func TestSignAndVerify(t *testing.T) {
	secret := "test-secret"
	body := []byte(`{"protocol":"API","payload":{}}`)
	sig := SignPayload(secret, body)
	hdr := FormatHeader(sig)
	if err := VerifyHeader(secret, hdr, body); err != nil {
		t.Fatal(err)
	}
	if err := VerifyHeader(secret, sig, body); err != nil {
		t.Fatal(err)
	}
	if err := VerifyHeader(secret, hdr, append(body, 'x')); err == nil {
		t.Fatal("expected mismatch")
	}
	if err := VerifyHeader(secret, "", body); err == nil {
		t.Fatal("expected missing")
	}
}
