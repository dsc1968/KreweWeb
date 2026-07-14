---
globs: '["backend/controllers/authController.js", "frontend/login.html",
  "frontend/auth.js", "frontend/dashboard.html"]'
description: MFA/SMS login and profile enrollment must respect the user's chosen
  method; never force email-only login or leave the profile SMS choice
  un-enrolled.
---

When SMS MFA is enabled in this project, the login flow (post__api_auth_login and frontend/login.html) MUST honor the user's saved MFA method (user.mfa_method) and offer the SMS ("Text me a code") option. Do NOT force email-only login or remove the SMS button from the mfa-method-switch. The profile "Text message (SMS)" option must actually enroll: when a member saves SMS with a phone, start an MFA challenge (send the code) and let them verify it (post__api_auth/mfa/verify sets mfa_enrolled=TRUE), so the choice saves and activates. Registration may still default to email, but login must respect the stored preference.