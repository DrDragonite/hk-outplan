var searchResults = [];

document.addEventListener("DOMContentLoaded", () => {
    dateSelectChange("start")
    dateSelectChange("end")
    document.getElementById("gpt_box").value = "";
})


function iconFromPlace(classname, place) {
    var searchStr = classname+place
    if (searchStr.includes("building")) {
        return "🏢"
    } else if (searchStr.includes("church")) {
        return "⛪"
    } else if (searchStr.includes("city")) {
        return "🏙️"
    } else if (searchStr.includes("peak")) {
        return "🗻"
    } else if (searchStr.includes("hill")) {
        return "🗻"
    } else if (searchStr.includes("castle")) {
        return "🏰"
    } else if (searchStr.includes("town")) {
        return "🏠"
    } else if (searchStr.includes("historic")) {
        return "🏛️"
    } else if (searchStr.includes("school")) {
        return "🏫"
    } else if (searchStr.includes("stadium")) {
        return "🏟️"
    } else if (searchStr.includes("university")) {
        return "🏫"
    } else if (searchStr.includes("tram_stop")) {
        return "🚏"
    } else if (searchStr.includes("bus_stop")) {
        return "🚏"
    } else if (searchStr.includes("train_stop")) {
        return "🚏"
    } else if (searchStr.includes("park")) {
        return "🌳"
    } else if (searchStr.includes("camp")) {
        return "⛺"
    } else if (searchStr.includes("platform")) {
        return "🚏"
    } else if (searchStr.includes("artwork")) {
        return "🎨"
    } else if (searchStr.includes("tourism")) {
        return "🧳"
    } else if (searchStr.includes("memorial")) {
        return "🏛️"
    } else if (searchStr.includes("information")) {
        return "ℹ"
    } else if (searchStr.includes("highway")) {
        return "🚘"
    } else if (searchStr.includes("village")) {
        return "🏘️"
    } else if (searchStr.includes("town")) {
        return "🏘️"
    } else if (searchStr.includes("water")) {
        return "🌊"
    } else if (searchStr.includes("lake")) {
        return "🌊"
    } else if (searchStr.includes("forest")) {
        return "🌲"
    } else {
        return "📍"
    }
}

function textAreaAdjust(element) {
    element.style.height = "1px";
    element.style.height = (25+element.scrollHeight)+"px";
}

function submitPlace() {
    var place = document.getElementById("place").value;
    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
            var response = JSON.parse(this.responseText)
            document.getElementById("placeSelect").innerHTML = ""
            searchResults = {}
            if (response.length > 0) {
                document.getElementById("placeSelect").disabled = false
            } else {
                document.getElementById("placeSelect").disabled = true
            }
            response.forEach(e => {
                searchResults[e.place_id] = e
                const newElement = document.createElement("option")
                newElement.innerHTML = iconFromPlace(e.class, e.type) + " "
                newElement.innerHTML += e.display_name
                // 0.32 * 0.32
                if ((e.boundingbox[1]-e.boundingbox[0])*(e.boundingbox[3]-e.boundingbox[2])>0.1024) { 
                    newElement.innerHTML += " (might not be accurate)"
                }
                newElement.value = e.place_id
                document.getElementById("placeSelect").appendChild(newElement)
            })
            embedUpdate()
        }
    };
    xhttp.open("GET", "https://nominatim.openstreetmap.org/search?q=" + place + "&format=json", true);
    xhttp.send();
}

/*
function processGpx() {
    let file = document.getElementById("gpxFile").files[0]
    
    if (file.type && !file.type.startsWith('application/gpx+xml')) {
        console.log('File is not a GPX file.', file.type, file);
        return;
    }
    let parser = new DOMParser()
    let gpxFile;
    const reader = new FileReader();
    reader.addEventListener('load', (event) => {
        gpxFile = parser.parseFromString(event.target.result, "text/xml")
        console.log(gpxFile.getElementsByTagName("trkpt")[0].getAttribute("lat"))
    });
    reader.readAsText(file);
}
*/

function getAdvice() {
    document.getElementById("gpt_box").value = "";
    clearAlerts();
    
    if (document.getElementById("start_dateselect").value == "today") {
        start = new Date()     
    } else if (document.getElementById("start_dateselect").value == "date") {
        start = new Date(document.getElementById("start_date").value)
    } else {
        var today = new Date()
        today.setDate(today.getDate() + Number(document.getElementById("start_offset_days").value))
        today.setHours(today.getHours() + Number(document.getElementById("start_offset_hours").value))
        start = today
    }
    if (document.getElementById("end_dateselect").value == "today") {
        end = new Date()
    } else if (document.getElementById("end_dateselect").value == "date") {
        end = new Date(document.getElementById("end_date").value)
    } else {
        var today = new Date()
        today.setDate(today.getDate() + Number(document.getElementById("end_offset_days").value))
        today.setHours(today.getHours() + Number(document.getElementById("end_offset_hours").value))
        end = today
    }
    var selectedPlace = searchResults[document.getElementById("placeSelect").value];

    var activity;
    if (document.getElementById("activity").value == "other") {
        activity = document.getElementById("otherActivity").value
    } else {
        activity = document.getElementById("activity").value
    }

    if (!activity) {
        alert("Please choose activity")
    } else {
        var xhttp = new XMLHttpRequest();
        xhttp.onreadystatechange = function() {
            if (this.readyState == 4) {
                document.getElementById("spinner").style.display = "none"
                if (this.status == 200) {
                    document.getElementById("gpt_box").value = this.responseText
                } else {
                    document.getElementById("gpt_box").value = "Data Not Found"
                }
                textAreaAdjust(document.getElementById("gpt_box"))
            } 
        };
        xhttp.onerror = () => {
            document.getElementById("spinner").style.display = "none"
            document.getElementById("gpt_box").value = "Network Error"
            textAreaAdjust(document.getElementById("gpt_box"))
        }
        const formData = new FormData();
        var params = {
            "lat": encodeURIComponent(selectedPlace.lat),
            "lon": encodeURIComponent(selectedPlace.lon),
            "class": encodeURIComponent(selectedPlace.class),
            "type": encodeURIComponent(selectedPlace.type),
            "activity": encodeURIComponent(activity),
            "startDate": start.valueOf(),
            "endDate": end.valueOf(),
            "utcOffset": new Date().getTimezoneOffset(),
        }
        for (let param in params) {
            formData.append(param, params[param])
        }
        for (let i = 0; i < document.getElementById("gpxFile").files.length; i++) {
            formData.append("photos", document.getElementById("gpxFile").files[i])
        }
        console.log(formData)
        var queryString = Object.keys(params).map(key => key + '=' + params[key]).join('&');
        xhttp.open("POST", "/advice", true);
        xhttp.send(formData);
        document.getElementById("spinner").style.display = ""

        var getDays = new XMLHttpRequest()
        getDays.onreadystatechange = function () {
            if (this.readyState == 4) {
                document.getElementById("weather-array").innerHTML = ""
                var days = JSON.parse(getDays.responseText).content
                days.forEach((day) => {
                    document.getElementById("weather-array").insertAdjacentHTML("beforeend", weatherCell(day.name, weatherEmoji(day.precipitation, day.cloudCoverage), day.dayTemp, day.nightTemp));
                })
            }
        }
        getDays.open("POST", "/weather?" + queryString, true);
        getDays.send()
    }

    if (end.getDate() == new Date().getDate()) {
        
        fetch("/alerts?" + new URLSearchParams({
            "lat": encodeURIComponent(selectedPlace.lat),
            "lon": encodeURIComponent(selectedPlace.lon),
            "endDate": end.valueOf(),

        })).then(x => x.json()).then(json => {
            json.content.forEach((a) => {
                document.querySelector(".col:last-child").insertAdjacentHTML("beforeend",
                    makeAlert(a.severity.toLowerCase() == "advisory" || a.severity.toLowerCase() == "watch" ? "yellow" : "red", a.title, a.description)
                );
            })
        });

        fetch("/air?" + new URLSearchParams({
            "lat": encodeURIComponent(selectedPlace.lat),
            "lon": encodeURIComponent(selectedPlace.lon),
            "endDate": end.valueOf(),

        })).then(x => x.json()).then(json => {
            const a = json
            if (a.aqi){
                document.querySelector(".col:last-child").insertAdjacentHTML("beforeend",
                    makeAlert("green", "Air Quality Index", a.aqi)
                );
            }
            if (a.pollen_level){
                document.querySelector(".col:last-child").insertAdjacentHTML("beforeend",
                    makeAlert("green", "Pollen Level", a.pollen_level)
                );
            }
            if (a.mold_level){
                document.querySelector(".col:last-child").insertAdjacentHTML("beforeend",
                    makeAlert("green", "Mold Level", a.mold_level)
                );
            }
        });
    }
}

function activitySelectChange() {
    if (document.getElementById("activity").value == "other") {
        document.getElementById("otherActivity").style.display = ""
    } else {
        document.getElementById("otherActivity").style.display = "none"
    }
}

function embedUpdate() {
    if (Object.keys(searchResults).length > 0) {
        var place = searchResults[document.getElementById("placeSelect").value]
        var bbox = [place.boundingbox[2], place.boundingbox[0], place.boundingbox[3], place.boundingbox[1]]
        var url = "https://www.openstreetmap.org/export/embed.html?bbox=" + bbox.join("%2C") + "&marker=" + place.lat + "%2C" + place.lon
        document.getElementById("preview").src = url
    }
}


function dateSelectChange(id) {
    if (document.getElementById(id+"_dateselect").value == "today") {
        document.getElementById(id+"_date").style.display = "none"
        document.getElementById(id+"_offset_days").style.display = "none"
        document.getElementById(id+"_offset_hours").style.display = "none"
    } else if (document.getElementById(id+"_dateselect").value == "date") {
        document.getElementById(id+"_date").style.display = ""
        document.getElementById(id+"_offset_days").style.display = "none"
        document.getElementById(id+"_offset_hours").style.display = "none"
    } else {
        document.getElementById(id+"_date").style.display = "none"
        document.getElementById(id+"_offset_days").style.display = ""
        document.getElementById(id+"_offset_hours").style.display = ""
    }
}


function onDateChange(id) {
    if (id == "start") {
        start = new Date(document.getElementById("start_date").value)
    } else {
        end = new Date(document.getElementById("end_date").value)
    }
}

function onOffsetChange(id) {
    if (id == "start") {
        var today = new Date()
        today.setDate(today.getDate() + Number(document.getElementById("start_offset_days").value))
        today.setHours(today.getHours() + Number(document.getElementById("start_offset_hours").value))
        start = today
    } else {
        var today = new Date()
        today.setDate(today.getDate() + Number(document.getElementById("end_offset_days").value))
        today.setHours(today.getHours() + Number(document.getElementById("end_offset_hours").value))
        end = today
    }
}

function weatherCell(title, emoji, dayTemp, nightTemp) {
    return `<div class="weather-cell"><span class="title">${title}</span><span class="emoji">${emoji}</span><div class="temp"><span class="day">${dayTemp}°C</span><span class="night">${nightTemp}°C</span></div></div>`;
}

function makeAlert(color, title, description, icon="⚠️") {
    return `<div class="alert ${color || ""}"><div><span>${icon}</span>${title || ""}</div><div>${description || ""}</div></div>`;
}

function clearAlerts() {
    for (let e of document.querySelectorAll(".alert")) {
        e.remove();
    }
}

function weatherEmoji(precipitation, cloud_coverage) {
    if (precipitation > 50) {
        return "🌧️"
    } else if (cloud_coverage > 67) {
        return "☁️"
    } else if (cloud_coverage > 33) {
        return "⛅"
    } else {
        return "☀️"
    }
}

