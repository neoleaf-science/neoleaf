#set document(title: "My Article on NeoLeaf", author: "Main Author")
#set page(paper: "a4", margin: 2.5cm, numbering: "1")
#set text(font: "Libertinus Serif", size: 11pt, lang: "en")
#set par(justify: true)
#set heading(numbering: "1.1")

#align(center)[
  #text(17pt, weight: "bold")[My Article on NeoLeaf] \
  Main Author \
  #datetime.today().display()
]

#align(center)[
  #block(width: 85%)[
    #align(left)[
      *Abstract.* This document shows NeoLeaf at work: a Typst project that lives in your own Git repository and compiles in the browser.
    ]
  ]
]

= Introduction

Write your text here. Typst marks up _emphasis_ with underscores and *strong text* with asterisks, and a reference to an equation or a figure uses its label, like @euler.

= Method

An equation, with a label:

$ e^(i pi) + 1 = 0 $ <euler>

A table:

#figure(
  table(
    columns: 3,
    [*Item*], [*Quantity*], [*Price*],
    [Apples], [3], [1.20],
    [Pears], [5], [2.00],
  ),
  caption: [A small table.],
) <tab:items>

= Results

See @tab:items. Cite a work with `@key` and list the references with a bibliography, as below @knuth1984.

#bibliography("refs.bib")
