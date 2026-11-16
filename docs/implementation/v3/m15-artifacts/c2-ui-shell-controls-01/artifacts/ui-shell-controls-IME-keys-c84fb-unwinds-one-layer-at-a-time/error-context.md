# Page snapshot

```yaml
- main [ref=e3]:
  - button "Open controls dialog" [ref=e4] [cursor=pointer]
  - dialog "Controls dialog" [ref=e5]:
    - generic [ref=e6]:
      - heading "Controls dialog" [level=2] [ref=e7]
      - button "Close dialog" [active] [ref=e8] [cursor=pointer]:
        - img [ref=e9]
    - generic [ref=e12]:
      - group [ref=e13]:
        - generic [ref=e14]:
          - combobox "Choice" [ref=e15] [cursor=pointer]:
            - generic [ref=e16]: Charlie
            - img [ref=e17]
          - combobox [ref=e19]
      - textbox "Following field" [ref=e20]: Keep draft
      - button "Submit choice" [ref=e21] [cursor=pointer]
      - button "Reset choice" [ref=e22] [cursor=pointer]
    - group [ref=e23]:
      - button "Actions" [ref=e24] [cursor=pointer]:
        - text: Actions
        - img [ref=e25]
    - button "Toggle disabled" [ref=e27] [cursor=pointer]
    - status "Result"
  - button "Background action" [ref=e28] [cursor=pointer]
```