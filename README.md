# Anki-Cards
A collection of custom-designed Anki note types.
Click on one of the card types below for explanations and a preview image.

|Type|Usage|
|:--|:--|
|[Definition](Definition/About.md)|A dictionary or terminology definitions. (Reversible)|
|[Choice](Choice/About.md)|A choice between one or more randomized options.|
|[Fact](Fact/About.md)|A fact.|
|[Formula](Formula/About.md)|A math formula.|

## Installation

**You must use Anki for Mac/Windows/Linux.**

1. Download `Anki-Cards.apkg` file from the [latest release](https://github.com/eth-p/Anki-Cards/releases/latest).
2. Using the Anki application, import the `Anki-Cards.apkg` package.
3. Optimize the Anki database. [(manual)](https://apps.ankiweb.net/docs/manual.html#checking-your-collection)
4. Congratulations! The note types have been added to your Anki database.

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
