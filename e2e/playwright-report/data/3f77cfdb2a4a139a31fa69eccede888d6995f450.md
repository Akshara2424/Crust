# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - text: 🔐
      - heading "Sign in" [level=1] [ref=e6]
      - paragraph [ref=e7]: Protected by CRUST passive verification
    - generic [ref=e8]:
      - generic [ref=e9]:
        - generic [ref=e10]: Username
        - textbox "Username" [ref=e11]:
          - /placeholder: Enter username
          - text: user
      - generic [ref=e12]:
        - generic [ref=e13]: Password
        - textbox "Password" [ref=e14]:
          - /placeholder: Enter password
          - text: pass
      - alert [ref=e15]: Verification failed. Please try again.
      - button "Try again" [ref=e16] [cursor=pointer]
    - paragraph [ref=e17]:
      - link "Go to Checkout demo →" [ref=e18] [cursor=pointer]:
        - /url: /checkout
  - generic [ref=e21]: "CRUST: pending…"
```