const express = require('express');
const OpenAI = require("openai");
const morgan = require("morgan");
const rateLimit = require('express-rate-limit');
require("dotenv").config();


/* -------------------------------------------------------------------------- */
/*                           Express initialization                           */
/* -------------------------------------------------------------------------- */

// init webserver
const app = express();
const port = 10117;

// make whitelist
const checkWL = ip => {
	const whitelist = ["::1", "127.0.0.1", "10.0.2.142", "10.0.2.137", "10.0.3.114", "10.0.2.138"]; // local, local, ja, marek, samo, filip
	return Boolean(whitelist.find(addr => ip.includes(addr)));
};

// webserver config
app.use(morgan("tiny"));
app.set('view engine', 'pug'); // set pug as renderer
app.set('views', './gui'); // locate template folder
app.use(rateLimit({
	windowMs: 60 * 1000,
	limit: 10,
	standardHeaders: 'draft-7',
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
	skip: req => {
		if (checkWL(req.ip))
			return true;
		if (req.path == "/")
			return true;
		return false;
	}
}));
app.use('/media', express.static('./media')); // serve static files from '/media' endpoint

/* -------------------------------------------------------------------------- */
/*                            OpenAI initialization                           */
/* -------------------------------------------------------------------------- */

// openai init
const openai = new OpenAI({
	apiKey: process.env['OPENAI_API_KEY'],
	maxRetries: 0,
	timeout: 5 * 1000,
});

const SYS_MSG = `
suggest appropriate clothing and precautions based on provided conditions as a short sentence
-----------------
keep all weather, location and activity information IMPLIED
suggestion categories: [long/short] sleeves, [winter/wind/light/waterproof] jacket, thermal clothing, [winter/tourist] shoes, umbrella, other
leave out categories that aren't applicable
do not mention location data, also don't suggest umbrella under high winds
add precautions related to weather but only potentially dangerous ones
-----------------
answer context: "What should I wear?"
answer format: "this, this and that"
precaution format: "beware this, avoid that"
full answer format: "[answer]; [precautions]"
`.trim();

// openai.chat.completions.create({
// 	messages: [{ role: 'user', content: 'Say this is a test' }],
// 	model: 'gpt-3.5-turbo',
// }).then(console.log);

/* -------------------------------------------------------------------------- */
/*                                 Router code                                */
/* -------------------------------------------------------------------------- */

// index page
app.get('/', (req, res) => {
	// if (!checkWL(req.ip))
	// 	return;
	res.render('index', {maxDays: process.env.FORECAST_MAX_DAYS});
});

function chunkArray(array, n) {
	const chunks = [];
	for (let i = 0; i < array.length; i += n) {
		chunks.push(array.slice(i, i + n));
	}
	return chunks;
}

app.post('/advice', async (req, res) => {
	const NOW = new Date();
	NOW.setMinutes(NOW.getMinutes() - 1); // account for request delay

	const MAX_DATE = new Date();
	MAX_DATE.setDate(NOW.getDate() + process.env.FORECAST_MAX_DAYS);
	
	// meteo params
	const lat = Number(req.query?.lat);
	if (isNaN(lat) || lat < -90 || lat > 90)
		return res.status(400).send("Invalid latitude");

	const lon = Number(req.query?.lon);
	if (isNaN(lon) || lon < -180 || lon > 180)
		return res.status(400).send("Invalid longitude");

	const startDate = Number(req.query.startDate);
	if (isNaN(startDate) || startDate < NOW.valueOf() || startDate > MAX_DATE.valueOf())
		return res.status(400).send("Invalid starting date");

	const endDate = Number(req.query.endDate);
	if (isNaN(endDate) || endDate < NOW.valueOf() || endDate > MAX_DATE.valueOf())
		return res.status(400).send("Invalid end date");

	if (startDate > endDate)
		return res.status(400).send("Start date must be before end date");

	// get additional info for ChatGPT
	const placeClass = req.query.class;
	const placeType = req.query.type;
	const activity = req.query.activity;

	const isoDates = [];

	const sampleCount = process.env.METEO_SAMPLES;
	const timeRange = endDate - startDate;
	const intervalPiece = timeRange / sampleCount;
	if (intervalPiece < 60 * 60 * 1000) {
		for (let d = startDate; d <= endDate; d += 60 * 60 * 1000) {
			isoDates.push(new Date(d).toISOString());
		}
	} else {
		for (let i = 0; i < sampleCount; i++) {
			isoDates.push(new Date(startDate + i*intervalPiece).toISOString());
		}
	}

	// get data from meteo api
	let meteoJSON;
	try {
		const resp = await fetch(`https://climathon.iblsoft.com/data/gfs-0.5deg/edr/collections/single-layer/position?coords=POINT(${lon} ${lat})&parameter-name=temperature_gnd-surf,snow-depth_gnd-surf,percent-frozen-precipitation_gnd-surf,wind-speed-gust_gnd-surf,pressure_gnd-surf,total-cloud-cover_atmosphere,visibility_gnd-surf,ice-cover_gnd-surf,relative-humidity_0-isoterm&datetime=${isoDates.join(",")}&f=CoverageJSON`);
		meteoJSON = await resp.json();
	} catch {
		console.log("Meteo request 1 failed");
		return res.sendStatus(500);
	}
	const utcOffset = Number(req.query.utcOffset);

	// split meteo data into days
	const paramCount = Object.keys(meteoJSON.parameters).length
	const samples = chunkArray(meteoJSON.coverages, paramCount); // should separate into days by `domain.time`

	// calculate interval for calculating perticipation
	const startDateMidnight = (new Date(startDate));
	startDateMidnight.setHours(0);
	startDateMidnight.setMinutes(-utcOffset);
	startDateMidnight.setSeconds(0);
	startDateMidnight.setMilliseconds(0);
	const isoDayStart = startDateMidnight.toISOString();

	const endDateMidnight = (new Date(endDate));
	endDateMidnight.setHours(24 - 6);
	endDateMidnight.setMinutes(-utcOffset);
	endDateMidnight.setSeconds(0);
	endDateMidnight.setMilliseconds(0);
	const isoDayEnd = endDateMidnight.toISOString(); // +18 hours because of 6h intervals

	// get rain amounts
	let rainJSON;
	try {
		const resp = await fetch(`https://climathon.iblsoft.com/data/gefs-0.25deg/edr/collections/single-level_2/position?coords=POINT(${lon} ${lat})&parameter-name=total-precipitation_gnd-surf_positively-perturbed_stat:acc/PT6H&datetime=${isoDayStart}/${isoDayEnd}&f=CoverageJSON`);
		rainJSON = await resp.json();
	} catch {
		console.log("Meteo request 2 failed");
		return res.sendStatus(500);
	}

	// calculate rain percentage from rain amounts
	const coverageCount = rainJSON.coverages.length;
	let rainPercent = 0;
	for (var i = 0; i < coverageCount; i++) {
		const nazov = "total-precipitation_gnd-surf_positively-perturbed_stat:acc/PT6H_mem-" + (Math.floor(i / (coverageCount / 30)) + 1);
		rainPercent += rainJSON.coverages[i].ranges[nazov].values[0] > 0.1;
	}
	rainPercent /= coverageCount;
	let frozenPercipitation = null;

	const minmaxData = {
		"temperature": { min: null, max: null },
		"wind_gust": { min: null, max: null },
		"pressure": { min: null, max: null },
		"snow_depth": { min: null, max: null },
		"cloud_coverage": { min: null, max: null },
		"visibility": { min: null, max: null },
		"ice_cover": { min: null, max: null },
		"humidity": { min: null, max: null }
	};

	for (let sample of samples) {
		const getParam = name => Object.entries(meteoJSON.parameters).findIndex(e => e[0] == name);
		const getEntry = param => ({ value: Object.values(sample[getParam(param)]?.ranges || {}).at(0)?.values.at(0), unit: meteoJSON.parameters[getParam(param)]?.unit?.symbol });
		const v = (val, def) => val === null ? def : (isNaN(val) ? val : Number(val));
		const minmax = (key, param) => {
			let value = getEntry(param).value;
			minmaxData[key] = {
				min: Math.min(v(minmaxData[key].min, value), value),
				max: Math.max(v(minmaxData[key].max, value), value)
			}
		};

		// collect data
		minmax("temperature", "temperature_gnd-surf");
		minmax("wind_gust", "wind-speed-gust_gnd-surf");
		minmax("pressure", "pressure_gnd-surf");
		minmax("snow_depth", "snow-depth_gnd-surf");
		minmax("cloud_coverage", "total-cloud-cover_atmosphere");
		minmax("visibility", "visibility_gnd-surf");
		minmax("ice_cover", "ice-cover_gnd-surf");
		minmax("humidity", "relative-humidity_0-isoterm");		

		const fp = getEntry("percent-frozen-precipitation_gnd-surf").value;
		frozenPercipitation = Math.max(frozenPercipitation || fp, fp);
	}

	// helper functions for formatting data
	const clamp = (val, min = 0, max = 1) => Math.min(max, Math.max(min, val));
	const normalize = (val, max = 100) => clamp(val, 0, max) / max;
	const valsplit = (val, namesSplit, nameEmpty = undefined, treshold = 0.1) => val > treshold ? namesSplit[Math.floor(val / (1 / namesSplit.length + 0.01))] : (typeof nameEmpty !== undefined ? nameEmpty : namesSplit[0]);
	const formatMm = (minmax, map = v=>v) => map(minmax.max) !== map(minmax.min) ? [minmax.min, minmax.max].filter(x => x !== null && x !== undefined).map(map).join(" to ") : map(minmax.max);

	// amount and type of precipitation
	const precipitation = valsplit(clamp(rainPercent), ["low", "medium", "high"], "no");
	const perticipationType = valsplit(normalize(frozenPercipitation), ["rain with snow", "snow"], "rain");

	// pressure is low, medium or high
	let pressureTypeMin = "low";
	if (minmaxData.pressure.min > 1002.5 && minmaxData.pressure.min <= 1031.5) {
		pressureTypeMin = "medium";
	} else if (minmaxData.pressure.min > 1031.5) {
		pressureTypeMin = "high";
	}
	let pressureTypeMax = "low";
	if (minmaxData.pressure.max > 1002.5 && minmaxData.pressure.max <= 1031.5) {
		pressureTypeMax = "medium";
	} else if (minmaxData.pressure.max > 1031.5) {
		pressureTypeMax = "high";
	}

	// amount of cloud coverage
	const cloudCoverageTypeMin = valsplit(normalize(minmaxData.cloud_coverage.min), ["clear", "partial", "overcast", "thick"])
	const cloudCoverageTypeMax = valsplit(normalize(minmaxData.cloud_coverage.max), ["clear", "partial", "overcast", "thick"])

	// visibility in haze
	const fogTypeMin = valsplit(normalize(minmaxData.visibility.min, 50_000), [null, null, null, "haze", "light fog", "thick fog"]);
	const fogTypeMax = valsplit(normalize(minmaxData.visibility.max, 50_000), [null, null, null, "haze", "light fog", "thick fog"]);

	// low medium or high humidity
	const humidityTypeMin = valsplit(normalize(minmaxData.humidity.min), ["low", "medium", "high", "very high"]);
	const humidityTypeMax = valsplit(normalize(minmaxData.humidity.max), ["low", "medium", "high", "very high"]);

	// compile data into readable format for ChatGPT
	let data = {
		"Temperature": formatMm(minmaxData.temperature, v=>Math.floor(v-273.15)) + " degrees celsius",
		"Precipitation": `${precipitation} chance of ${perticipationType}`,
		"Wind gusts": formatMm(minmaxData.wind_gust, Math.floor) + " m/s",
		"Pressure": formatMm({"min": pressureTypeMin, "max": pressureTypeMax}),
		"Snow depth": (minmaxData.snow_depth.max || null) && minmaxData.snow_depth.max + " m",
		"Cloud coverage": formatMm({"min": cloudCoverageTypeMin, "max": cloudCoverageTypeMax}),
		"Fog type": formatMm({ "min": fogTypeMin, "max": fogTypeMax }),
		"Ice cover": minmaxData.ice_cover.max ? "yes" : null,
		"Humidity": formatMm({"min": humidityTypeMin, "max": humidityTypeMax}),
		"Location": [placeClass, placeType].filter(x => x).join(", "),
		"Activity": activity,
	}

	// filter out invalid and hidden values
	data = Object.entries(data).filter(e => !(e[1] === null || e[1] === undefined || e[1] === ""));

	const contentMsg = data.map(x => x.join(": ")).join("\n");

	console.log(contentMsg);

	//query ChatGPT to generate description
	const gptResponse = await openai.chat.completions.create({
		messages: [
			{ role: 'system', content: SYS_MSG },
			{ role: 'user', content: contentMsg }
		],
		model: 'gpt-3.5-turbo',
		temperature: 0,
	});

	const gptText = gptResponse.choices[0].message.content;

	res.send(gptText);
})


app.post('/weather', async (req, res) => {
	const NOW = new Date();
	NOW.setMinutes(NOW.getMinutes() - 1); // account for request delay

	const MAX_DATE = new Date();
	MAX_DATE.setDate(NOW.getDate() + process.env.FORECAST_MAX_DAYS);
	
	// meteo params
	const lat = Number(req.query?.lat);
	if (isNaN(lat) || lat < -90 || lat > 90)
		return res.status(400).send("Invalid latitude");

	const lon = Number(req.query?.lon);
	if (isNaN(lon) || lon < -180 || lon > 180)
		return res.status(400).send("Invalid longitude");

	const startDate = Number(req.query.startDate);
	if (isNaN(startDate) || startDate < NOW.valueOf() || startDate > MAX_DATE.valueOf())
		return res.status(400).send("Invalid starting date");

	const endDate = Number(req.query.endDate);
	if (isNaN(endDate) || endDate < NOW.valueOf() || endDate > MAX_DATE.valueOf())
		return res.status(400).send("Invalid end date");

	if (startDate > endDate)
		return res.status(400).send("Start date must be before end date");

	const utcOffset = Number(req.query.utcOffset);

	const isoDates = [];
	for (let d = startDate; d <= endDate; d += 24 * 60 * 60 * 1000) {
		let midnight = new Date(d)
		midnight.setHours(0);
		midnight.setMinutes(-utcOffset);
		midnight.setSeconds(0);
		midnight.setMilliseconds(0);
		isoDates.push(midnight.toISOString());

		let noon = new Date(d)
		noon.setHours(12);
		noon.setMinutes(-utcOffset);
		noon.setSeconds(0);
		noon.setMilliseconds(0);
		isoDates.push(noon.toISOString());
	}
	
	
	// get data from meteo api
	let meteoJSON;
	try {
		const resp = await fetch(`https://climathon.iblsoft.com/data/gfs-0.5deg/edr/collections/single-layer/position?coords=POINT(${lon} ${lat})&parameter-name=temperature_gnd-surf,total-cloud-cover_atmosphere&datetime=${isoDates.join(",")}&f=CoverageJSON`);
		meteoJSON = await resp.json();
	} catch {
		console.log("Meteo request 1 failed");
		return res.sendStatus(500);
	}

	// split meteo data into days
	const paramCount = Object.keys(meteoJSON.parameters).length
	const samples = chunkArray(meteoJSON.coverages, paramCount); // should separate into days by `domain.time`

	// calculate interval for calculating perticipation
	const startDateMidnight = (new Date(startDate));
	startDateMidnight.setHours(0);
	startDateMidnight.setMinutes(0);
	startDateMidnight.setSeconds(0);
	startDateMidnight.setMilliseconds(0);
	const isoDayStart = startDateMidnight.toISOString();

	const endDateMidnight = (new Date(endDate));
	endDateMidnight.setHours(24 - 6);
	endDateMidnight.setMinutes(0);
	endDateMidnight.setSeconds(0);
	endDateMidnight.setMilliseconds(0);
	const isoDayEnd = endDateMidnight.toISOString(); // +18 hours because of 6h intervals

	// get rain amounts
	let rainJSON;
	try {
		const resp = await fetch(`https://climathon.iblsoft.com/data/gefs-0.25deg/edr/collections/single-level_2/position?coords=POINT(${lon} ${lat})&parameter-name=total-precipitation_gnd-surf_positively-perturbed_stat:acc/PT6H&datetime=${isoDayStart}/${isoDayEnd}&f=CoverageJSON`);
		rainJSON = await resp.json();
	} catch {
		console.log("Meteo request 2 failed");
		return res.sendStatus(500);
	}

	// calculate rain percentage from rain amounts
	const coverageCount = rainJSON.coverages.length;
	let rainPercent = 0;
	for (var i = 0; i < coverageCount; i++) {
		const nazov = "total-precipitation_gnd-surf_positively-perturbed_stat:acc/PT6H_mem-" + (Math.floor(i / (coverageCount / 30)) + 1);
		rainPercent += rainJSON.coverages[i].ranges[nazov].values[0] > 0.1;
	}
	rainPercent /= coverageCount;

	const days = new Array(samples.length/2).fill().map(()=>Object.fromEntries(Object.entries({"name": null, "dayTemp": null, "nightTemp": null, "cloudCoverage": null, "precipitation": null})));
	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i];
		const dayI = Math.floor(i / 2);
		
		const getParam = name => Object.entries(meteoJSON.parameters).findIndex(e => e[0] == name);
		const getEntry = param => ({ value: Object.values(sample[getParam(param)]?.ranges || {}).at(0).values.at(0), unit: meteoJSON.parameters[getParam(param)]?.unit?.symbol });
		
		const weekday = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

		if (i%2 == 0) {
			days[dayI].nightTemp = Math.floor(getEntry("temperature_gnd-surf").value-273.15)
		} else {
			days[dayI].name = weekday[new Date(isoDates[i]).getDay() || 0]
			days[dayI].dayTemp = Math.floor(getEntry("temperature_gnd-surf").value-273.15)
			days[dayI].cloudCoverage = Math.floor(("total-cloud-cover_atmosphere").value)
			days[dayI].precipitation = Math.floor(rainPercent*100)
		}

	}

	res.send({content:days});
})


app.get("/alerts", async (req, res) => {
	// get alerts from api
	const apiKey = process.env.WEATHERBIT_API_KEY;

	// get dates
	const NOW = new Date();
	NOW.setMinutes(NOW.getMinutes() - 1); // account for request delay

	const MAX_DATE = new Date();
	MAX_DATE.setHours(23);
	MAX_DATE.setMinutes(59);
	MAX_DATE.setSeconds(59);
	MAX_DATE.setMilliseconds(9999);

	// get and validate input values
	const lat = Number(req.query?.lat);
	if (isNaN(lat) || lat < -90 || lat > 90)
		return res.status(400).send("Invalid latitude");

	const lon = Number(req.query?.lon);
	if (isNaN(lon) || lon < -180 || lon > 180)
		return res.status(400).send("Invalid longitude");

	const endDate = Number(req.query.endDate);
	if (isNaN(endDate) || endDate < NOW.valueOf() || endDate > MAX_DATE.valueOf())
		return res.sendStatus(200);

	let alertJSON;
	try {
		const resp = await fetch(`https://api.weatherbit.io/v2.0/alerts?lat=${lat}&lon=${lon}&key=${apiKey}`);
		alertJSON = await resp.json();
	} catch {
		console.log("Alert request failed");
		return res.sendStatus(500);
	}

	// store unique output alerts
	const alerts = [];

	// capture unique alerts
	var alertNames = new Set(alertJSON.alerts.map(obj => obj.title));
	alertNames.forEach((alertName) => {
		var alert = alertJSON.alerts.find(obj => obj.title == alertName);
		alerts.push({
			"title": alert.title,
			"description": alert.description,
			"severity": alert.severity
		});
	});

	res.send({content:alerts});
});
	
app.get("/air", async (req, res) => {
	// get air info from api
	const apiKey = process.env.WEATHERBIT_API_KEY
	
	// get dates
	const NOW = new Date();
	NOW.setMinutes(NOW.getMinutes() - 1); // account for request delay

	const MAX_DATE = new Date();
	MAX_DATE.setHours(23);
	MAX_DATE.setMinutes(59);
	MAX_DATE.setSeconds(59);
	MAX_DATE.setMilliseconds(9999);

	// get and validate input params
	const lat = Number(req.query?.lat);
	if (isNaN(lat) || lat < -90 || lat > 90)
		return res.status(400).send("Invalid latitude");

	const lon = Number(req.query?.lon);
	if (isNaN(lon) || lon < -180 || lon > 180)
		return res.status(400).send("Invalid longitude");

	const endDate = Number(req.query.endDate);
	if (isNaN(endDate) || endDate < NOW.valueOf() || endDate > MAX_DATE.valueOf())
		return res.sendStatus(200);

	let airJSON;
	try {
		const resp = await fetch(`https://api.weatherbit.io/v2.0/current/airquality?lat=${lat}&lon=${lon}&key=${apiKey}`);
		airJSON = await resp.json();
	} catch {
		console.log("Air info request failed");
		return res.sendStatus(500);
	}

	// helper functions
	const clamp = (val, min = 0, max = 1) => Math.min(max, Math.max(min, val));
	const normalize = (val, max = 100) => clamp(val, 0, max) / max;
	const valsplit = (val, namesSplit, nameEmpty = undefined, treshold = 0.1) => val > treshold ? namesSplit[Math.floor(val / (1 / namesSplit.length + 0.01))] : (typeof nameEmpty == undefined ? nameEmpty : namesSplit[0]);

	// capture unique air info
	const jsonData = airJSON.data[0];
	const aqi = jsonData.aqi;
	const pollen = Math.max(jsonData.pollen_level_grass, jsonData.pollen_level_tree, jsonData.pollen_level_weed);
	const mold = jsonData.mold_level;

	// translate info into text
	const aqiText = valsplit(normalize(aqi, 300), [null, null, "Unhealthy", "Very Unhealthy", "Hazardous"]);
	const pollenText = valsplit(normalize(pollen, 4), [null, "Low", "Medium", "High"]);
	const moldText = valsplit(normalize(mold, 4), [null, "Low", "Medium", "High"]);

	// filter info by severity
	let data = {
		aqi: aqiText,
		pollen_level: pollenText,
		mold_level: moldText
	};
	data = Object.fromEntries(Object.entries(data).filter(e => e[1] !== null && e[1] !== undefined));

	res.send(data);
})


// should be at end of file
app.listen(port, () => {
	console.log(`Example app listening on port ${port}`);
})