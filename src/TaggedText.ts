import * as PIXI from "pixi.js";
import { parseTagsNew, removeTags } from "./tags";
import {
  TaggedTextOptions,
  TextStyleSet,
  TextStyleExtended,
  TagWithAttributes,
  AttributesList,
  ImageMap,
  IMG_SRC_PROPERTY,
  FinalToken,
  isSpriteToken,
  TextFinalToken,
  isTextToken,
  isNotWhitespaceToken,
  isNewlineToken,
  isWhitespaceToken,
  Point,
  ParagraphToken,
  TextDecorationMetrics,
} from "./types";
import { capitalize } from "./stringUtil";
import { calculateFinalTokens, getBoundsNested } from "./layout";
import {
  combineAllStyles,
  DEFAULT_STYLE,
  getStyleForTag as getStyleForTagExt,
  mapTagsToStyles,
} from "./style";

export const DEFAULT_OPTIONS: TaggedTextOptions = {
  debug: false,
  debugConsole: false,
  splitStyle: "words",
  imgMap: {},
  skipUpdates: false,
  skipDraw: false,
  drawWhitespace: false,
};

// TODO: make customizable
const DEBUG = {
  WORD_STROKE_COLOR: 0xffcccc, // #FCC
  WORD_FILL_COLOR: 0xeeeeee, // #EEE
  TEXT_FIELD_STROKE_COLOR: 0xff00ff, // #F0F
  WHITESPACE_COLOR: 0xcccccc, // #CCC
  WHITESPACE_STROKE_COLOR: 0xaaaaaa, // #AAA
  BASELINE_COLOR: 0xffff99, // #FF9
  LINE_COLOR: 0xffff00, // #FF0
  OUTLINE_COLOR: 0xffcccc, // #FCC
  OUTLINE_SHADOW_COLOR: 0x000000, // #000
  TEXT_STYLE: {
    fontFamily: "courier",
    fontSize: 10,
    fill: 0xffffff, // #FFF
    dropShadow: true,
  },
};

export default class TaggedText extends PIXI.Sprite {
  // todo: allow setting options after the constructor is called. Make sure to call update()
  /** Settings for the TaggedText component. */
  private _options: TaggedTextOptions;
  public get options(): TaggedTextOptions {
    return this._options;
  }

  private _needsUpdate = true;
  public get needsUpdate(): boolean {
    return this._needsUpdate;
  }
  private _needsDraw = true;
  public get needsDraw(): boolean {
    return this._needsDraw;
  }

  private _tokens: ParagraphToken = [];
  public get tokensFlat(): FinalToken[] {
    return this._tokens.flat(3);
  }
  /**
   * Tokens representing parsed out and styled tagged text. This is generated by update.
   * They contain all the information needed to render the text fields and other children in your component.
   */
  public get tokens(): ParagraphToken {
    return this._tokens;
  }

  private _text = "";
  public get text(): string {
    return this._text;
  }

  /**
   * Alternative implicit setter for text. Always uses default for skipUpdate.
   */
  public set text(text: string) {
    this.setText(text);
  }

  /**
   * Setter for text that allows you to override the default for skipping the update.
   * @param text Text to add to component with (optional) tags.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the text.
   * When true, setText() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public setText(text: string, skipUpdate?: boolean): void {
    if (text === this._text && this._needsUpdate === false) {
      return;
    }
    this._text = text;
    this._needsUpdate = true;
    this.updateIfShould(skipUpdate);
  }

  /**
   * Returns the text content with all tags stripped out.
   */
  public get untaggedText(): string {
    return removeTags(this.text);
  }

  private _tagStyles: TextStyleSet = {};
  public get tagStyles(): TextStyleSet {
    return this._tagStyles;
  }

  /**
   * Alternative implicit setter for tagStyles. Always uses default for skipUpdate.
   */
  public set tagStyles(styles: TextStyleSet) {
    this.setTagStyles(styles);
  }

  /**
   * Setter for tagStyles.
   * @param styles Object with strings for keys representing tag names, mapped to style objects.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the styles.
   * When true, setTagStyles() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public setTagStyles(styles: TextStyleSet, skipUpdate?: boolean): void {
    Object.entries(styles).forEach(([tag, style]) =>
      this.setStyleForTag(tag, style, true)
    );
    // TODO: add a way to test for identical styles to prevent unnecessary updates.
    this._needsUpdate = true;
    this.updateIfShould(skipUpdate);
  }

  public getStyleForTag(
    tag: string,
    attributes: AttributesList = {}
  ): TextStyleExtended | undefined {
    return getStyleForTagExt(tag, this.tagStyles, attributes);
  }

  public getStyleForTags(tags: TagWithAttributes[]): TextStyleExtended {
    const styles = tags.map(({ tagName, attributes }) =>
      this.getStyleForTag(tagName, attributes)
    );
    return combineAllStyles(styles);
  }

  /**
   * Set a style to be used by a single tag.
   * @param tag Name of the tag to set style for
   * @param styles Style object to assign to the tag.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the styles.
   * When true, setStyleForTag() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public setStyleForTag(
    tag: string,
    styles: TextStyleExtended,
    skipUpdate?: boolean
  ): boolean {
    this.tagStyles[tag] = styles;

    // TODO: warn user when trying to set styles on a tag that doesn't support it...
    // e.g. wordWrapWidth on a styel other than default.

    // Override some settings on default styles.
    if (tag === "default" && this.defaultStyle[IMG_SRC_PROPERTY]) {
      // prevents accidentally setting all text to images.
      console.error(
        `Style "${IMG_SRC_PROPERTY}" can not be set on the "default" style because it will add images to EVERY tag!`
      );
      this.defaultStyle[IMG_SRC_PROPERTY] = undefined;
    }
    // TODO: add a way to test for identical styles to prevent unnecessary updates.
    this._needsUpdate = true;
    this.updateIfShould(skipUpdate);

    return true;
  }
  /**
   * Removes a style associated with a tag. Note, inline attributes are not affected.
   * @param tag Name of the tag to delete the style of.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the styles.
   * When true, removeStylesForTag() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public removeStylesForTag(tag: string, skipUpdate?: boolean): boolean {
    if (tag in this.tagStyles) {
      delete this.tagStyles[tag];

      this._needsUpdate = true;
      this.updateIfShould(skipUpdate);

      return true;
    }
    return false;
  }

  public get defaultStyle(): TextStyleExtended {
    return this.tagStyles?.default;
  }
  /**
   * Alternative implicit setter for defaultStyle. Always uses default for skipUpdate.
   */
  public set defaultStyle(defaultStyles: TextStyleExtended) {
    this.setDefaultStyle(defaultStyles);
  }
  /**
   * Setter for default styles. A shortcut to this.setStyleForTag("default",...)
   * @param styles A style object to use as the default styles for all text in the component.
   * @param skipUpdate *For advanced users* overrides default for upating / redrawing after changing the styles.
   * When true, setDefaultStyle() never updates even if default is false, and vice versa.
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public setDefaultStyle(
    defaultStyles: TextStyleExtended,
    skipUpdate?: boolean
  ): void {
    this.setStyleForTag("default", defaultStyles, skipUpdate);
  }

  // References to internal elements.
  private _textFields: PIXI.Text[] = [];
  public get textFields(): PIXI.Text[] {
    return this._textFields;
  }
  private _sprites: PIXI.Sprite[] = [];
  public get sprites(): PIXI.Sprite[] {
    return this._sprites;
  }
  private _decorations: PIXI.Graphics[] = [];
  public get decorations(): PIXI.Graphics[] {
    return this._decorations;
  }
  public get spriteTemplates(): PIXI.Sprite[] {
    return Object.values(this.options?.imgMap ?? {});
  }
  private _debugGraphics: PIXI.Graphics | null = null;

  // Containers for children
  private _textContainer: PIXI.Container;
  public get textContainer(): PIXI.Container {
    return this._textContainer;
  }

  private _decorationContainer: PIXI.Container;
  public get decorationContainer(): PIXI.Container {
    return this._decorationContainer;
  }

  private _spriteContainer: PIXI.Container;
  public get spriteContainer(): PIXI.Container {
    return this._spriteContainer;
  }
  private _debugContainer: PIXI.Container;
  public get debugContainer(): PIXI.Container {
    return this._debugContainer;
  }

  constructor(
    text = "",
    tagStyles: TextStyleSet = {},
    options: TaggedTextOptions = {},
    texture?: PIXI.Texture
  ) {
    super(texture);

    this._textContainer = new PIXI.Container();
    this._spriteContainer = new PIXI.Container();
    this._decorationContainer = new PIXI.Container();
    this._debugContainer = new PIXI.Container();

    this.addChild(this._textContainer);
    this.addChild(this._spriteContainer);
    this.addChild(this._decorationContainer);
    this.addChild(this._debugContainer);

    this.resetChildren();

    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    this._options = mergedOptions;

    tagStyles = { default: {}, ...tagStyles };
    const mergedDefaultStyles = { ...DEFAULT_STYLE, ...tagStyles.default };
    tagStyles.default = mergedDefaultStyles;
    this.tagStyles = tagStyles;

    if (this.options.imgMap) {
      this.registerImageMap(this.options.imgMap);
    }

    this.text = text;
  }

  /**
   * Removes all PIXI children from this component's containers.
   * Deletes references to sprites and text fields.
   */
  private resetChildren() {
    this._debugContainer.removeChildren();
    this._textContainer.removeChildren();
    this._spriteContainer.removeChildren();
    this._decorationContainer.removeChildren();

    this._textFields = [];
    this._sprites = [];
    this._decorations = [];
  }

  /**
   * Creates associations between string-based keys like "img" and
   * image Sprite objects which are included in the text.
   * @param imgMap
   */
  private registerImageMap(imgMap: ImageMap) {
    Object.entries(imgMap).forEach(([key, sprite]) => {
      // Listen for changes to sprites (e.g. when they load.)
      const texture = sprite.texture;
      if (texture !== undefined) {
        texture.baseTexture.addListener(
          "update",
          (baseTexture: PIXI.BaseTexture) =>
            this.onImageTextureUpdate(baseTexture)
        );
      }

      // create a style for each of these by default.
      const existingStyle = this.getStyleForTag(key) ?? {};
      const style = { [IMG_SRC_PROPERTY]: key, ...existingStyle };
      this.setStyleForTag(key, style);
    });
  }

  private onImageTextureUpdate(baseTexture: PIXI.BaseTexture): void {
    baseTexture;
    this._needsUpdate = true;
    this._needsDraw = true;
    // const didUpdate = this.updateIfShould();
    this.updateIfShould();

    // this.dispactchEvent(new Event("imageUpdate", texture));
  }

  /**
   * Determines whether to call update based on the parameter and the options set then calls it or sets needsUpdate to true.
   * @param forcedSkipUpdate This is the parameter provided to some functions that allow you to skip the update.
   * It's factored in along with the defaults to figure out what to do.
   */
  private updateIfShould(forcedSkipUpdate?: boolean): boolean {
    if (
      forcedSkipUpdate === false ||
      (forcedSkipUpdate === undefined && this.options.skipUpdates === false)
    ) {
      this.update();
      return true;
    }
    return false;
  }

  /**
   * Calculates styles, positioning, etc. of the text and styles and creates a
   * set of objects that represent where each portion of text and image should
   * be drawn.
   * @param skipDraw *For advanced users* overrides default for redrawing the styles.
   * When true, update() will skip the call to draw() (even if the default is false).
   * Options are true, false, or undefined. Undefined is the default and means it uses whatever setting
   * is provided in this.options.
   */
  public update(skipDraw?: boolean): ParagraphToken {
    // Determine default style properties
    const tagStyles = this.tagStyles;
    const { imgMap, splitStyle } = this.options;
    // const wordWrapWidth = this.defaultStyle.wordWrap
    //   ? this.defaultStyle.wordWrapWidth
    //   : Number.POSITIVE_INFINITY;
    // const align = this.defaultStyle.align;
    // const lineSpacing = this.defaultStyle.lineSpacing;

    // Pre-process text.
    // Parse tags in the text.
    const tagTokensNew = parseTagsNew(this.text, Object.keys(this.tagStyles));
    // Assign styles to each segment.
    const styledTokens = mapTagsToStyles(tagTokensNew, tagStyles, imgMap);
    styledTokens;
    // Measure font for each style
    // Measure each segment
    // Create the text segments, position and add them. (draw)
    const newFinalTokens = calculateFinalTokens(styledTokens, splitStyle);

    this._tokens = newFinalTokens;
    this._needsDraw = true;

    // Wait one frame to draw so that this doesn't happen multiple times in one frame.
    // if (this.animationRequest) {
    //   window.cancelAnimationFrame(this.animationRequest);
    // }
    // this.animationRequest = window.requestAnimationFrame(

    this.drawIfShould(skipDraw);

    if (this.options.debugConsole) {
      console.log(this.toDebugString());
    }

    this._needsUpdate = false;

    return newFinalTokens;
  }

  /**
   * Determines whether to call draw() based on the parameter and the options set then calls it or sets needsDraw to true.
   * @param forcedSkipDraw This is the parameter provided to some functions that allow you to skip the update.
   * It's factored in along with the defaults to figure out what to do.
   */
  private drawIfShould(forcedSkipDraw?: boolean): boolean {
    if (
      forcedSkipDraw === false ||
      (forcedSkipDraw === undefined && this.options.skipDraw === false)
    ) {
      this.draw();
      return true;
    }

    return false;
  }

  /**
   * Create and position the display objects based on the tokens.
   */
  public draw(): void {
    this.resetChildren();
    const { drawWhitespace } = this.options;
    const tokens = drawWhitespace
      ? this.tokensFlat
      : // remove any tokens that are purely whitespace unless drawWhitespace is specified
        this.tokensFlat.filter(isNotWhitespaceToken);

    let drewDecorations = false;
    let displayObject: PIXI.DisplayObject;

    tokens.forEach((t) => {
      if (isTextToken(t)) {
        displayObject = this.createTextFieldForToken(t as TextFinalToken);
        this.textContainer.addChild(displayObject);
        this.textFields.push(displayObject as PIXI.Text);

        if (t.textDecorations && t.textDecorations.length > 0) {
          for (const d of t.textDecorations) {
            const drawing = this.createDrawingForTextDecoration(d);
            (displayObject as PIXI.Text).addChild(drawing);
            this._decorations.push(drawing);
          }
          drewDecorations = true;
        }
      }
      if (isSpriteToken(t)) {
        displayObject = t.content as PIXI.Sprite;
        this.sprites.push(displayObject as PIXI.Sprite);
        this.spriteContainer.addChild(displayObject);
      }

      const { bounds } = t;
      displayObject.x = bounds.x;
      displayObject.y = bounds.y;
    });

    if (drawWhitespace === false && drewDecorations) {
      console.warn(
        "Warning: you may want to set the `drawWhitespace` option to `true` when using textDecoration (e.g. underlines) otherwise, spaces will not have text decorations."
      );
    }

    if (this.options.debug) {
      this.drawDebug();
    }
    this._needsDraw = false;
  }

  private createDrawingForTextDecoration(
    textDecoration: TextDecorationMetrics
  ): PIXI.Graphics {
    const { bounds } = textDecoration;
    let { color } = textDecoration;
    const drawing = new PIXI.Graphics();

    if (typeof color === "string") {
      if (color.indexOf("#") === 0) {
        color = "0x" + color.substring(1);
        color = parseInt(color, 16) as number;
      } else {
        throw new Error(
          "Sorry, at this point, only hex colors are supported for textDecorations like underlines. Please use either a hex number like 0x66FF33 or a string like '#66FF33'"
        );
      }
    }

    drawing
      .beginFill(color as number)
      .drawRect(bounds.x, bounds.y, bounds.width, bounds.height)
      .endFill();

    return drawing;
  }

  private createTextFieldForToken(token: TextFinalToken): PIXI.Text {
    const { textTransform = "" } = token.style;
    let text = token.content;
    switch (textTransform.toLowerCase()) {
      case "lowercase":
        text = text.toLowerCase();
        break;
      case "uppercase":
        text = text.toUpperCase();
        break;
      case "capitalize":
        text = capitalize(text);
        break;
      default:
    }

    return new PIXI.Text(text, token.style);
  }

  /**
   * Converts the text properties from this.tokens into a human readable string.
   * This is automatically logged to the console on update when debug option is set to true.
   */
  public toDebugString(): string {
    const lines = this.tokens;
    let s = this.untaggedText + "\n=====\n";
    const nl = "\n    ";
    if (lines !== undefined) {
      s += lines.map((line, lineNumber) =>
        line.map((word, wordNumber) =>
          word
            .map((token, tokenNumber) => {
              let text = "";
              if (isTextToken(token)) {
                if (isNewlineToken(token)) {
                  text = `\\n`;
                } else {
                  text = `"${token.content}"`;
                }
              } else if (isSpriteToken(token)) {
                text = `[Image]`;
              }
              let s = `\n${text}: (${lineNumber}/${wordNumber}/${tokenNumber})`;
              s += `${nl}tags: ${
                token.tags.length === 0
                  ? "<none>"
                  : token.tags
                      .split(",")
                      .map((tag) => `<${tag}>`)
                      .join(", ")
              }`;
              s += `${nl}style: ${Object.entries(token.style)
                .map((e) => e.join(":"))
                .join("; ")}`;
              s += `${nl}size: x:${token.bounds.x} y:${token.bounds.y} width:${
                token.bounds.width
              } height:${token.bounds.height} bottom:${
                token.bounds.height + token.bounds.y
              } right:${token.bounds.x + token.bounds.width}`;
              s += `${nl}font: fontSize:${token.fontProperties.fontSize} ascent:${token.fontProperties.ascent} descent:${token.fontProperties.descent}`;
              return s;
            })
            .join("\n")
        )
      );
    }
    return s;
  }

  public drawDebug(): void {
    const paragraph = this.tokens;
    this._debugGraphics = new PIXI.Graphics();
    this.debugContainer.addChild(this._debugGraphics);

    const g = this._debugGraphics;
    g.clear();

    // const { width, height } = this.getBounds();
    // // frame shadow
    // g.lineStyle(2, DEBUG.OUTLINE_SHADOW_COLOR, 0.5);
    // // g.beginFill();
    // g.drawRect(1, 1, width, height);
    // // g.endFill();

    // // frame
    // g.lineStyle(2, DEBUG.OUTLINE_COLOR, 1);
    // // g.beginFill();
    // g.drawRect(0, 0, width - 1, height - 1);
    // // g.endFill();

    function createInfoText(text: string, position: Point): PIXI.Text {
      const info = new PIXI.Text(text, DEBUG.TEXT_STYLE);
      info.x = position.x + 1;
      info.y = position.y + 1;
      return info;
    }

    // for (const line of tokens) {
    for (let lineNumber = 0; lineNumber < paragraph.length; lineNumber++) {
      const line = paragraph[lineNumber];
      const lineBounds = getBoundsNested(line);

      if (this.defaultStyle.wordWrap) {
        const w = this.defaultStyle.wordWrapWidth ?? this.width;
        g.endFill()
          .lineStyle(0.5, DEBUG.LINE_COLOR, 0.2)
          .drawRect(0, lineBounds.y, w, lineBounds.height)
          .endFill();
      }

      for (let wordNumber = 0; wordNumber < line.length; wordNumber++) {
        const word = line[wordNumber];
        for (const segmentToken of word) {
          const isSprite = isSpriteToken(segmentToken);
          const { x, y, width } = segmentToken.bounds;
          const baseline =
            y +
            (isSprite
              ? segmentToken.bounds.height
              : segmentToken.fontProperties.ascent);

          let { height } = segmentToken.bounds;
          if (isSprite) {
            height += segmentToken.fontProperties.descent;
          }

          if (
            isWhitespaceToken(segmentToken) &&
            this.options.drawWhitespace === false
          ) {
            g.lineStyle(1, DEBUG.WHITESPACE_STROKE_COLOR, 1).beginFill(
              DEBUG.WHITESPACE_COLOR,
              0.2
            );
          } else {
            g.lineStyle(1, DEBUG.WORD_STROKE_COLOR, 1).beginFill(
              DEBUG.WORD_FILL_COLOR,
              0.2
            );
          }

          if (isNewlineToken(segmentToken)) {
            this.debugContainer.addChild(
              createInfoText("↩︎", { x, y: y + 10 })
            );
          } else {
            g.lineStyle(0.5, DEBUG.LINE_COLOR, 0.2)
              .drawRect(x, y, width, height)
              .endFill()

              .lineStyle(1, DEBUG.BASELINE_COLOR, 1)
              .beginFill()
              .drawRect(x, baseline, width, 1)
              .endFill();
          }

          let info;
          // info = `${token.bounds.width}⨉${token.bounds.height}`;
          if (isTextToken(segmentToken)) {
            // info += ` ${token.tags}`;
            info = `${segmentToken.tags}`;
            this.debugContainer.addChild(createInfoText(info, { x, y }));
          }
          // this.debugContainer.addChild(createInfoText(info, { x, y }));
        }
      }
    }
    // }

    // Show the outlines of the actual text fields,
    // not just where the tokens say they should be
    // const fields: PIXI.Text[] = this.textFields;
    // for (const text of fields) {
    //   g.lineStyle(1, DEBUG.TEXT_FIELD_STROKE_COLOR, 1);
    //   g.drawRect(text.x, text.y, text.width, text.height);
    // }
  }
}
