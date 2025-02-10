# Hoyoverse Web Event Data Scraper

A helper tool to extract assets (namely images and their associated JSON spine data) from Hoyoverse web.

## Usage

1. Clone the repository:
    ```sh
    git clone https://github.com/DaneRainbird/hoyoverse-web-event-data-scraper.git
    cd hoyoverse-web-event-data-scraper
    ```

2. Open `index.html` in your web browser.

3. Enter a valid Hoyoverse event URL (e.g., `https://act.hoyoverse.com/zzz/event/e20250124year-z2p5y6/index.html`) in the input field.

4. Click the "Input" button to start the extraction process.

5. Once the extraction is complete, a ZIP file containing the resources will be generated and downloaded automatically.

## What can I do with the extracted data?

Typically, HoyoLAB web events consist of images and JSON files that contain [Spine](http://esotericsoftware.com/) data. YOu can use Spine to view and animate these assets. 

n.b. If you're going try load this data into Spine, I'd strongly suggest ensuring your device has a Chinese locale set. This is because the HoyoLAB's web event configuration data uses strings containing Chinese characters, and you will face various esoteric issues if your device can't render the names of the assets and their components.

## Project Structure

- `index.html`: The main HTML file containing the user interface.
- `res/js/zzz.js`: The main JavaScript file containing the logic for extracting resources and generating the ZIP file.

## Dependencies

- [StreamSaver.js](https://jimmywarting.github.io/StreamSaver.js/StreamSaver.js)
- [regenerator-runtime](https://cdn.jsdelivr.net/npm/regenerator-runtime@0.13.9/runtime.min.js)
- [JSZip](https://stuk.github.io/jszip/dist/jszip.min.js)

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

## Contributing

The format of these web events often changes, especially between games. This tool has been tested with Genshin Impact, Zenless Zone Zero, and Honkai Star Rail events, but I can't garuantee it will work with future events. If you find an event that doesn't work, please open an issue or submit a pull request.

## Acknowledgements

- Content created and owned by HoyoLAB, miHoYo Co., Ltd., and its licensors.