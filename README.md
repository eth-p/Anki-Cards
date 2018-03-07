# Anki-Cards
A collection of custom-designed Anki flashcards.

|Type|Explanation|
|:--|:--|
|[Definition](Definition/About.md)|The definition of a term. (Reversible)|
|[Choice](Choice/About.md)|A multiple choice question.|
|[Fact](Fact/About.md)|A fact.|
|[Formula](Formula/About.md)|A math formulag.|


## Building

To build the cards' CSS and HTML templates, you need to run a couple commands:

```shell
npm install
npm run build
```

This will create a `Release` directory with subdirectories for each card type.

## Contributing

### Anki Qt Compatibility

Please note that Anki Qt's web renderer is quite old, and does not
have support for many modern features such as JavaScript's `let` or CSS's `flex`.
